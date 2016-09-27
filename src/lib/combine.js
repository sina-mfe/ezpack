/**
 * @author xiaojue[designsor@gmail.com]
 * @fileoverview combine file
 */
var utils = require('./utils');
var path = require('path');
var assert = require('assert');
var fs = require('fs');
var cssmin = require('cssmin');
var URLRewriteStream = require('cssurl').URLRewriteStream;
var byline = require('byline').LineStream;
var request = require('request');
var combineTarget = require('./combineTarget');
var svn = require('svn-interface');
var through2 = require('through2');
var Readable = require('stream').Readable;
var uglify = require('uglify-js');
var cwd = process.cwd();
var sass = require('sass.js');
var cssbeautify = require('cssbeautify');
var babel = require('babel-core');
var nodelog = require('log-timestamp');
var log4js = require('log4js');
var syncClinet = require('../wapModuleClient');
var colors = require('colors'); 
var CONST_prtlprefix="window.prtl.prefix"; 
var CONST_http_config_url = ['svn:https://svn1.intra.sina.com.cn/wapcms/js/wap_dev/public/https/httpsjson.js','https://svn1.intra.sina.com.cn/wapcms/js/wap_dev/public/https/httpsjson.js'];
var CONST_http_protocol_url =  ['svn:https://svn1.intra.sina.com.cn/wapcms/js/wap_dev/public/https/httpsSupport.js','https://svn1.intra.sina.com.cn/wapcms/js/wap_dev/public/https/httpsSupport.js'];
var CONST_http_config_json;
var logprefix = require('log-prefix');
var sourceMap = {};
var logger = log4js.getLogger(path.basename(__filename));
var readline = require('readline');
var watch = require('node-watch');
var watchPathArr = [];
function combine(svninfo) {
  this.svninfo = svninfo;
  this.deps = [];
}

function urlRewrite(filepath, cnf) {
  cnf = cnf || {};
  cnf.exts = cnf.exts || ['.css'];
  cnf.online = cnf.online || /http(s?)/i;
  cnf.replacer = cnf.replacer || path.dirname(filepath);
  //cnf.replacers = cnf.replacers.split('/');

  var urlRewriteIns = new URLRewriteStream(function(url){
    console.log('find '+ url + ' for rewrite!');
    if(!cnf.online.test(url)){
       url = cnf.replacer + '/' + url;
       return url += (url.indexOf('?') === -1 ? '?' : '&') + 't='+Date.now();
    }
    return url;
  });
  return cnf.exts.indexOf(path.extname(filepath)) !== -1 ? urlRewriteIns : through2(function(chunk, enc, cb){this.push(chunk);cb()});
}

function sassOrEsOrEs66(ext, es6, toSass) {
  function transform(chunk, enc, cb) {
    if (!this.source) {
      this.source = '';
    }
    this.source += chunk;
    cb();
  }
  var transformEnd;
  if (ext === '.css') {
    transformEnd = function(cb) {
      var self = this;
      console.log('beautify css...');
      var css = cssbeautify(this.source);
      if (toSass) {
        console.log('compile css for sass...');
        sass.compile(css, function(result) {
          if (result.text) {
            self.push(result.text);
            cb();
          } else {
            cb(result);
          }
        });
      } else {
        this.push(css);
        cb();
      }
    };
  } else if (ext === '.js') {
    transformEnd = function(cb) {
      if (es6) {
        // console.log('babel js for es6...');
        // var js = babel.transform(this.source, {
        //   //blacklist: ["useStrict"],
        //   //ignore: ['useStrict'],
        //   presets: ['es2015'],
        //   sourceMaps: true,
        //   compact: false
        // });
        // sourceMap.babel = js.map;
        this.push(this.source);
      } else {
        this.push(this.source);
      }
      cb();
    };
  }
  return through2(transform, transformEnd);
}

utils.definePublicPros(combine.prototype, {
  concat: function(filepath, keyword, ext, es6, toSass,enableHttp) {
    var line = new byline();
    this.deps = [];
    //var extraCnf = this.__cnf;
    var params = {
      svninfo: this.svninfo,
      deps: this.deps,
      keyword: keyword,
      ext: ext,
      es6:es6,
      enableHttp:enableHttp,
      filepath: filepath,
      //extraCnf: extraCnf
    };
    var stream = fs.createReadStream(filepath, {
        encoding: 'utf-8'
      })
      .pipe(line)
      .pipe(parseDepend(params))
      
      .pipe(combineStream(params))
      .pipe(sassOrEsOrEs66(ext, es6, toSass))
      .on('error', function(e) {
        console.error(e);
      });
    return stream;
  }
});

combine.build = function(filepath, config, output, beautify, es6, toSass, enableMap,enableDebug,enableHttp) {
  var ext = path.extname(filepath),
    target;
  var filestream = new combine({
    username: config.svninfo.username,
    password: config.svninfo.password,
    command: config.svninfo.command
  }).concat(filepath, config.keywords[ext], ext, es6, toSass,enableHttp);
  if (beautify) {
    target = path.resolve(cwd, beautify);
    filestream.pipe(fs.createWriteStream(target)).on('finish', function() {
      console.info('beautify success: ' + target);
    });
  }
  if (output) {
    target = path.resolve(cwd, output);
    filestream.pipe(through2(function(chunk, enc, cb) {
      if (!this.code) {
        this.code = '';
      }
      this.code += chunk;
      cb();
    }, function(cb) {
      var result;
      if (ext === '.js') {
        console.log('minify js by uglify...');
        var uglifyOptions = {
          fromString: true,
        };
        enableMap && (uglifyOptions.outSourceMap=(path.basename(target) + '.map'));
        if (sourceMap.babel) {
          uglifyOptions.inSourceMap = sourceMap.babel;
        }
        
        var js 
        if(enableDebug){
          result = this.code;
        } 
        else{
          js= uglify.minify(this.code, uglifyOptions);
          result = js.code;
        }
        if(enableHttp){
          //http更改js
          console.log('https处理开始');
          var domainlist = getReplacedDomainList.apply(this);
          result = dealHttp(result,domainlist);
          console.log('https处理结束');
        }
        if(enableMap&&!enableDebug){
          js.map = JSON.parse(js.map);
          js.map.file  = 'unknown';
          js.map.sources[0] = 'unknown';
          if(!js.map.sourcesContent){
            js.map.sourcesContent = [this.code];
          }
          fs.writeFileSync(target + '.map', JSON.stringify(js.map));
        }
      } else if (ext === '.css') {
        console.log('min css by cssmin...');
        result = cssmin(this.code);
      }
      this.push(result);
      cb();
    })).pipe(fs.createWriteStream(target)).on('finish', function() {
      console.info('build output: ' + target);
    });
  }
};
combine.watch = function(filepath,config, output, beautify, es6, toSass, enableMap,enableDebug,enableHttp){
  var rl = readline.createInterface({
    input: fs.createReadStream(filepath,{
      enconding:'utf8'
    }),
    output: null
  });
  rl.on('line',function(line){
    watchFile(filepath,line);
  });
  rl.on('close',function(){
    if(watchPathArr.length > 0){
      watch(watchPathArr, function(file) {
        console.log('the file changed');
        combine.build(filepath, config, output, beautify, es6, toSass, enableMap,enableDebug,enableHttp);
      });
    }
  });
}
function watchFile(filepath,line){
  // var requireName = line.split('@')[0];
  var type,requirePath;
    var reg = new RegExp('^\\s*@require\\s*\\(\\s*([\'|\"])([\\w\\-\\.\\/\\_\\:\\?\\=\\&]*)\\1\\s*\\)\\s*;?', 'gi');
    var matches = reg.exec(line);
   
    if(matches && matches[2]){
      requirePath = matches[2];
      type = utils.getRquireType(requirePath);
      if(type === 'local'){
         watchPathArr.push(path.resolve(path.dirname(requirePath), requirePath));
      }
    };
}
var pipe_count = 0;
function pipeFile(file, params) {
  var line = new byline(),
    target = new combineTarget();
  file.pipe(line)
    .pipe(parseDepend(params))
    .pipe(combineStream(params))
    .pipe(target)
    .on('finish', function() {
      var ext = params.ext;
      if (ext === '.js'&&this.file!='') {
        this.file = '\r\ntry{' + this.file + '}catch(e){console["error" in console ? "error" : "log"](e, "'+params.errorFile+'");}\r\n';
      } else if (ext === '.css') {
        this.file = this.file + '/*' + params.errorFile + '*/ \r\n';
      }
      console.log('finish dispose ' + params.errorFile + '...');
      // params.cb(null, this.file);
      if(params.es6){
      	 var js = babel.transform(this.file, {
	        // blacklist: ["useStrict"],
	        // ignore: ['useStrict'],
          filename:__filename,
          presets:[['es2015',{loose:true,modules: false,strict:false}]],
          plugins:[["transform-es2015-modules-commonjs", { allowTopLevelThis:true,strict:false}]],
	        sourceMaps: true,
	        compact: false
	      });
	      //sourceMap.babel = js.map;
	      //this.push(js.code);
	      params.cb(null, js.code);
      }
      else{
      	// var js = babel.transform(this.file, {
	      //   //blacklist: ["useStrict"],
	      //   //ignore: ['useStrict'],
	      //   presets: ['es2015'],
	      //   sourceMaps: true,
	      //   compact: false
	      // });
	      // //sourceMap.babel = js.map;
	      // //this.push(js.code);
	      params.cb(null, this.file);
      }
      
    });
}

function parseDepend(params){
  return through2(function(line, enc, cb){
    line = line.toString();
    try{
      //syncClinet
      let matcher = line.match(/^\s*@(dependPlugin|dependModule)\(([^\)]+)\)/);
      switch(matcher && matcher[1]){
        case 'dependPlugin':
          //logger.debug('get dependPlugin type:'+matcher[2]);
          if(matcher[2] === 'babel'){
            !params._dependPlugin && (params._dependPlugin=[]);
            params._dependPlugin.push('babel');
          }
          line = '';
        break;
        case 'dependModule':
          //var depenModule = matcher[2].split(',');
          var depenModule = matcher[2];
          var dependModules = [];
          depenModule.split(',').forEach((item) => {
            try{
              var [mName, mVer] = item.split('#');
              if(mName && mVer){
                dependModules.push(syncClinet.buildIndexKey({name:mName, ver: mVer}));
              }
            }catch(err){
              logger.error(err);
            }
          });
          logger.debug('find depend modules:', dependModules);
          return syncClinet.updateIndex().then((indexMap) => {
            var metaIds = [];
            dependModules.forEach((key) => {
              var [name,ver] = syncClinet.splitIndexKey(key);
              if(ver === '*' && syncClinet.moduleVerMap[name] && syncClinet.moduleVerMap[name].length){
                key = syncClinet.buildIndexKey({name: name, ver: syncClinet.moduleVerMap[name].sort().pop()});
                //logger.debug('rebuild modulekey key:',key);
              }
              indexMap.hasOwnProperty(key) && metaIds.push(indexMap[key]);
            });
            if(metaIds.length){
              syncClinet.getModuleByIds(metaIds).then((idsMap) => {
                var combineContent = [];
                logger.debug('get idMetas infos', idsMap);
                metaIds.forEach((metaId) => {
                  if(idsMap.hasOwnProperty(metaId)){
                    var item = idsMap[metaId];
                    item.type === 'svn' && (item.url='svn:'+item.url);
                    combineContent.push(params.keyword+"('"+idsMap[metaId].url+"')");
                  }
                });
                logger.debug('get real path:', combineContent);
                cb(null, combineContent.join(';'));
              }).catch((err) => {
                logger.error(err);
                cb(null, '');
              });
            }
            
          }).catch((err) => {
            logger.error(err);
            cb(null, '');
          });
        default:
        break;
      }
    }catch(err){
      logger.info(err);
    }
    // if(['/*', '*/'].indexOf(line.trim()) !== -1){
    //   line = '';
    // }
    cb(null, line);
  });
}

function loopRequire(requireNames, params, done){
  if(requireNames instanceof Array){
    //var totalContent = '';
    //logger.debug('get multi requires', requireNames);
    var requireName = requireNames.shift();
    if(requireName){
      loopRequire(requireName, params);
    }else{
      done && done(null, params.totalContent);
      // params.cb(null, totalContent);
    }
  }else{
    var requireName = requireNames;
    var filePath = requireName;
    requireName = requireName.split('@')[0];
    var extname = path.extname(requireName);
    // if (extname === params.ext) {//当js后面有？时判断不成立
      //先放入堆栈，有重复的不放，忽略，算循环引用，结束之后剔除堆栈
      var type = utils.getRquireType(requireName);
      if (type === 'local' || type === 'svn' || type === 'http') {
        if (params.deps.indexOf(requireName) === -1) {
          params.deps.push(requireName);
          getRequireString({
            extraCnf: params.extraCnf,
            svninfo: params.svninfo,
            deps: params.deps,
            keyword: params.keyword,
            ext: params.ext,
            type: type,
            es6:params.es6,
            filepath: type === 'local' ? path.resolve(path.dirname(params.filepath), filePath) : filePath,
            errorFile: path.basename(requireName),
            cb: params.cb
          });
        } else {
          params.cb();
        }
      } else {
        params.cb(new Error('type is illegal ' + type + ' , ' + requireName));
      }
    // } else {
    //   params.cb(new Error('extname is illegal ' + requireName));
    // }
  }
}

function getRs(result) {
  var rs = new Readable;
  rs.push(result);
  rs.push(null);
  return rs;
}
function getRequireString(params) {
  console.log('start get ' + params.filepath + '...');
  if (params.type === 'local') {
    pipeFile(fs.createReadStream(params.filepath, {
      encoding: 'utf-8'
    }), params);
  } else if (params.type === 'http') {
    pipeFile(request(params.filepath).on('response', function(res) {
    }).pipe(urlRewrite(params.filepath)), params);
  } 
  else if (params.type === 'svn') {
    svn._setCommand(params.svninfo.command || 'svn');
    var filepath = params.filepath.replace(/^svn\:/, '');
    svn.cat(filepath, {
      username: params.svninfo.username,
      password: params.svninfo.password
      }, function(err, result) {
      if (err) {
        throw new Error(err);
      }else{
        var rs;
        if(filepath == CONST_http_config_url[1]){
          CONST_http_config_json = JSON.parse(result);
          result = 'window.httpsjson='+result;
          rs = getRs(result);
        }else{
          rs = getRs(result);
        }
        pipeFile(rs, params);
      }
    })
  }
}

function combineStream(params) {
  return through2(function(line, enc, cb) {
    
    var reg = new RegExp('^\\s*' + params.keyword + '\\s*\\(\\s*([\'|\"])([\\w\\-\\.\\/\\_\\:\\?\\=\\&]*)\\1\\s*\\)\\s*;?', 'gi');
    // var reg = new RegExp('^\\s*'+params.keyword+'\\(\'(.*)\'\\)');
    //logger.debug(reg);
    line = line.toString();
    var lineParts = line.split(';');
    var requireNames = [];
    if(pipe_count == 0&&params.enableHttp){
      requireNames = [CONST_http_protocol_url[0],CONST_http_config_url[0]];
    }
    lineParts.forEach((part) => {
      var matches = reg.exec(part);
      // var matchArr = part.match(reg);
      matches && requireNames.push(matches[2]);
    });
    line += '\r\n';
    pipe_count++;
    if(requireNames.length){
      var newParams = {
        totalContent: '',
        requireNames: requireNames,
        extraCnf: params.extraCnf,
        svninfo: params.svninfo,
        deps: params.deps,
        es6:params.es6,
        enableHttp:params.enableHttp,
        keyword: params.keyword,
        ext: params.ext,
        filepath: params.filepath,
        cb: function(err, content){
          assert.equal(err, null);
          newParams.totalContent+=content;
          loopRequire(newParams.requireNames, newParams, cb);
        }
      };
      loopRequire(newParams.requireNames, newParams, cb);
    }else{
      line += '\r\n';
      cb(null, line);
    }
  });
}
function getReplacedDomainList(){
    var me =this;
    if(CONST_http_config_json.prtldomain.length>0){
      return CONST_http_config_json.prtldomain;
    }else{
      return []
    }
};
function dealHttp(fileString,domainlist){
  var result;
  // var regstr = /(["'])(\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/g;//该正则适配范围较广
  var regstr = /["'](\w+):\/\/([^/:]+)(:\d*)?([^# ][^\\\r\n]*)/g;//该正则只适配url地址
  var isdeal = false;
  content=fileString.replace(regstr,function(a,b){
      //获取http的前面的引号类型。
      var refIcon = ['"',"'"];
      var patref = refIcon.indexOf(a[0]);
      if(patref!=-1){
          // ''+window.prtl.prefix+''+(window.prtl.type=='http'?'mjs.sinaimg.cn':'mjss.sinaimg.cn')+'/wap/online/public/images/addToHome/sina_114x114_v1.png';
          //判断是否重复执行。。目前重复执行的存在于上一行代码中现象。判断逻辑》》》》
          //处理http和https
          if(a.indexOf("http://")>=0){
              isdeal=true;
          }
          a = a.replace("http://",refIcon[patref]+"+"+CONST_prtlprefix+"+"+refIcon[patref]);
          domainlist.forEach(function(element) {
              if(a.indexOf("'"+element.http+"'")==-1&&a.indexOf(element.http)>=0){
                  isdeal=true;
                  a=a.replace(element.http,function(a,b){
                      return refIcon[patref]+"+(window.prtl.type=='http'?'"+element.http+"':'"+element.https+"')+"+refIcon[patref]
                  })
              }
              if(a.indexOf("'"+element.https+"'")==-1&&a.indexOf(element.https)>=0){
                  isdeal=true;
                  a=a.replace(element.https,function(a,b){
                      return refIcon[patref]+"+(window.prtl.type=='http'?'"+element.http+"':'"+element.https+"')+"+refIcon[patref]
                  })
              }
          }, this);
          return a;
          //处理domain
      }
      else{
          //解析错误
      }
      
      return a;
  });

    return content;
}
// function combineStream(params) {
//   return through2(function(line, enc, cb) {
//     var reg = new RegExp('^\\s*' + params.keyword + '\\s*\\(\\s*([\'|\"])([\\w\\-\\.\\/\\_\:]*)\\1\\s*\\)\\s*;?', 'gi');
//     line = line.toString() + '\r\n';
//     var matches = reg.exec(line);
//     if (matches && matches[2]) {
//       var requireName = matches[2];
//       var extname = path.extname(requireName);
//       if (extname === params.ext) {
//         //先放入堆栈，有重复的不放，忽略，算循环引用，结束之后剔除堆栈
//         var type = utils.getRquireType(requireName);
//         if (type === 'local' || type === 'svn' || type === 'http') {
//           if (params.deps.indexOf(requireName) === -1) {
//             params.deps.push(requireName);
//             getRequireString({
//               svninfo: params.svninfo,
//               deps: params.deps,
//               keyword: params.keyword,
//               ext: params.ext,
//               type: type,
//               filepath: type === 'local' ? path.resolve(path.dirname(params.filepath), requireName) : requireName,
//               errorFile: path.basename(requireName),
//               cb: cb
//             });
//           } else {
//             cb();
//           }
//         } else {
//           cb(new Error('type is illegal ' + type + ' , ' + requireName));
//         }
//       } else {
//         cb(new Error('extname is illegal ' + requireName));
//       }
//     } else {
//       cb(null, line);
//     }
//   });
// }
function patch(fn) {
  logprefix(fn || timestamp);
}
patch();
function timestamp() {
  return ('[' + new Date().toISOString() + ']').yellow;
}
module.exports = getReplacedDomainList;
module.exports = patch;
module.exports = combine;

