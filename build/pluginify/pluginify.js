steal("underscore",
	"fs",
	"path",
	"./parse.js",
	"steal-tools/build/open",
	"./open.js",
	"steal-tools/build/js",
	function(_, fs, path, parse, open, opener, js){

	var readFile = require("../../node/utils").readFile;
	
	var BLANK_HTML = path.resolve(__dirname, "../../node/blank.html");

	var noop = function(){};

	function clone(o){
		return JSON.parse(JSON.stringify(o));
	}

	var ignores = [
		'steal/dev/dev.js',
		'stealconfig.js',
		/\.less$/,
		/\.css$/
	];

	/**
	 *
	 * @param ids
	 * @param options
	 * @param callback
	 */
	function pluginify(ids, options, callback) {
		options.minify = typeof options.minify === "boolean"
			? options.minify : true;

		if(!options.steal) {
			var config = pluginify.loadConfig();
			var shim = clone(config.shim);
		}

		var stealData = _.extend({}, options.steal, {
			startId: ids
		});

		var getSteals = opener.steals;
		var thingToBuild = /\.html$/i.test(ids) ? ids : BLANK_HTML;
		open(thingToBuild, stealData, function (opener) {
			var steals = getSteals(opener.rootSteal, options);

			// Call pluginifySteals and extend the options with the opener Steal
			pluginify.pluginifySteals(steals, _.extend({
				opener: opener,
				shim: shim,
				ignore: ignores.concat(options.ignore||[])
			}, options), callback || noop);
		});
	}

	_.extend(pluginify, {
		defaults: {
			wrapper: '(function(undefined) {\n<%= content %>\n\n' +
				'<%= exports.join("\\n") %>\n' +
				'})();\n',
			exportsTemplate: 'window[\'<%= name %>\'] = <%= module %>;',
			moduleTemplate: '\n// ## <%= moduleName %>\nvar <%= variableName %> = ' +
				'(<%= parsed %>)(<%= dependencies.join(", ") %>);'
		},

		/**
		 * Returns if the given id should be ignored
		 *
		 * @param {String} id The id to check
		 * @param {Array} ignores A list of regular expressions or strings to check.
		 * Strings ending with `/` will be treated as folders.
		 * @returns {Boolean} Whether to ignore the id or not
		 */
		ignores: function(id, ignores) {
			return _.some(ignores, function(current) {
				if(current.test) {
					return current.test(id);
				}
				if(/\/$/.test(current)) {
					return id.indexOf(current) === 0;
				}
				return current === id;
			});
		},

		/**
		 * Pluginify a list of steal dependencies
		 *
		 * @param steals
		 * @param options
		 * @param callback
		 */
		pluginifySteals: function(steals, options, callback) {
			if (!callback) {
				callback = options;
				options = {};
			}

			options = _.extend({}, pluginify.defaults, options);

			// Stores mappings from module ids to pluginified variable names
			var nameMap = {};
			var contents = [];

			var pageSteal = options.opener.steal;
			_.each(options.shim, function(variable, id) {
				var val = variable.exports
					? variable.exports : variable;
				nameMap[pageSteal.id(id)] = val;
			});

			var extractContent = function(stl){
				var filename = path.resolve('' + pageSteal.config('root'),
					stl.options.src+"");

				return readFile(filename);
			};

			// Go through all dependencies
			opener.visit(steals, function (stl, id, visited, index) {
				// If the steal has its content loaded (done by the opener) and we don't have a registered
				// variable name for that module
				if(stl.options.type !== "fn" && !nameMap[id] && !pluginify.ignores(id, options.ignore || [])){
					if(!stl.options.text){
						var text = extractContent(stl);
						stl.options.text = text;
					}
					stl.options.parsed = opener.parseContent(stl.options.text);
				}


				if (stl.options.text && !nameMap[id] && !pluginify.ignores(id, options.ignore || [])) {
					steal.print("\ \ +", id);

					// Create a variable name containing the visited array length
					var variableName = '__m' + index;
					// Set the variable name for the current id
					nameMap[id] = variableName;

					// When we come back from the recursive call all our dependencies are already
					// parsed and have a name. Now create a list of all the variables names.
					var dependencies = stl.dependencies.map(function (dep) {
						return nameMap['' + dep.options.id];
					});

					// The last dependency is the module itself, we don't need that
					dependencies.pop();

					// Create the dependency as strings, so undefineds work.
					var depStrs = dependencies.map(function(d){ return d || "undefined"; });

					// Render the template for this module
					var part = _.template(options.moduleTemplate, {
						moduleName: id,
						variableName: variableName,
						parsed: stl.options.parsed,
						dependencies: depStrs
					});

					contents.push(part);
				}

			});

			if(!contents.length) {
				throw new Error('No files to pluginify');
			}

			var exportModules = [];
			if (options.exports) {
				// Get all the modules to export
				exportModules = _.map(options.exports, function (name, moduleId) {
					// options.opener should be the Steal instance used to retrieve the pluginified
					// steals so that we can map ids with the correct configuration. Use `steal.load` as a fallback
					return _.template(options.exportsTemplate, {
						name: name,
						module: nameMap['' + options.opener.id(moduleId)]
					});
				});
			}

			var javascript = _.template(options.wrapper, {
				content: contents.join('\n'),
				exports: exportModules
			});

			var out = options.out || options.to;
			if(out) {
				var save = pluginify.save;
				out = pluginify.outFileName(out);

				var fun = options.minify
					? js.minify.bind(null, javascript, {})
					: function(cb) { cb(javascript); };

				fun(function(data){
					save(data, out);
					callback();
				});

			} else {
				callback(javascript);
			}
		},

		loadConfig: function(){
			var fileName = path.resolve(process.cwd(), "stealconfig.js");
			var rawContents = readFile(fileName);
			var getConfig = new Function("steal", "return " + rawContents);
			var data = getConfig({
				config: function(o) { return o; }
			});
			return data;
		},

		/*
		 * Normalizes files/directories into usable
		 * out file names.
		 */
		outFileName: function(inFileName){
			var stats = fs.statSync(inFileName);
			if(stats.isDirectory()) {
				return path.resolve(inFileName + "/", "production.js")
			}

			return inFileName;
		},

		save: function(data, out){
			var uri = new steal.URI(out);
			uri.save(data);
		},

		getFunction: parse
	});

	steal.build.pluginify = pluginify;

	return pluginify;

});
