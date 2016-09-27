var path = require('path');
var fs = require('fs');
var assert = require('assert');

var log4js = require('log4js');
var request = require('request');
var url = require('url');
var through2 = require('through2');
var svn = require('svn-interface');

var {utils, FileCache} = require('../util');
//var fileCache = require('../file_cache');
var logger = log4js.getLogger(path.basename(__filename));

class ModuleClient{
  constructor(cnf={}){
    //default cnf
    utils.extend(cnf, {
      cachePath: './cache',
      cacheTimeout: 86400,
      api:{
        host: 'http://wap_front.dev.sina.cn:8089/',
        path: {
          index: 'api/moduleIndex',
          module: 'api/module'
        },
        validMethod: ['POST', "GET", "PUT", "DELETE"]
      },
      indexCacheTime: 5*60*1000,
      indexCacheKey: 'moduleIndexCacheV1',
      metaInfosCacheKey: 'moduleMetaInfosCacheV1',
      activeFilecache: false
    });
    
    // this.stat = {
    //   fileCacheIns: new FileCache(this.cnf.cachePath, 100)
    // };
    // var fileCacheIns = new FileCache(this.cnf.cachePath, 100);

    //获取index缓存
    var fileCache = null;
    if(cnf.activeFilecache){
      fileCache = new FileCache(this.cnf.cachePath, 100);
    }
    var indexInfoCacheRaw = cnf.activeFilecache && fileCache.getCache(cnf.indexCacheKey, 'string');
    var moduleIndex={
      _stat: {
        curVer: 0,
        indexLastUpdateTime: 0,
        moduleVerMap: {},
        len: 0
      },
    };
    if(indexInfoCacheRaw){
      try{
        moduleIndex = JSON.parse(indexInfoCacheRaw);
      }catch(err){
        logger.debug('parse index cache error:',err);
      }
    }
    logger.debug('init moduleindex cache done!');

    //获取metaInfo缓存
    var metaInfosCacheRaw = cnf.activeFilecache && fileCache.getCache(cnf.metaInfosCacheKey, 'string');
    var metaCache = {};
    if(metaInfosCacheRaw){
      try{
        metaCache = JSON.parse(metaInfosCacheRaw);
      }catch(err){
        logger.debug('parse meta cache error:', err);
      }
    }
    logger.debug('init metainfo cache done!');

    this.stat = {
      metaCache,
      moduleIndex
    };
    this.cnf = cnf;
    // this.fileCacheIns = new FileCache(this.cnf.cachePath, 100);
    // this.cnf.indexCacheTime > 0 && (this.cnf.indexLastUpdateTime=0);
    // this.moduleIndex = {};
    // this.moduleVerMap = {};
    // this.metaCache = {};
    // var moduleIndexCacheContent = this.fileCacheIns.getCache('moduleIndex')
  }
  sendRequest(method, type, data){
    return new Promise((done, fail) => {
      var apiCnf = this.cnf.api;
      var params;
      if(!apiCnf.path.hasOwnProperty(type) || apiCnf.validMethod.indexOf(method) === -1){
        return fail('invalid request params!');
      }
      params = {
        method: method,
        url: url.resolve(apiCnf.host, apiCnf.path[type]),
      };
      if(method === 'GET'){
        params.url += '?' + data;
      }else{
        utils.extend(params, {
          //json: true,
          // body: data,
          // headers: {
          //   'Content-Type':'application/x-www-form-urlencoded'
          // }
          form: data
        });
      }
      //logger.debug('ready for sent', params);
      request(params).pipe(through2(function(chunk, enc, cb){
        //logger.debug('receiving data……');
        !this.respContent && (this.respContent='');
        this.respContent += chunk;
        cb();
      }, function(cb){
        //logger.debug('receive done!');
        try{
          done(JSON.parse(this.respContent))
        }catch(err){
          logger.error(this.respContent);
        }
        fail('invalid resp!');
      }))
    });
  }
  updateIndex(ver){
    var {curVer, indexCacheTime, indexLastUpdateTime, activeFilecache, indexCacheKey} = this.cnf;
    var {moduleIndex, metaCache} = this.stat;
    var {curVer, indexLastUpdateTime, moduleVerMap} = moduleIndex._stat;
    ver = ver || curVer || 0;
    return new Promise((done, fail) => {
      logger.debug('lastupdatetime:',indexLastUpdateTime)
      if(indexCacheTime > 0 && (Date.now() - indexLastUpdateTime) < indexCacheTime){
        done(utils.clone(moduleIndex, ['_stat']));
      }else{
        logger.debug('start update!');
        this.sendRequest('GET', 'index', 'gver='+ver).then((resp) => {
          if(!resp || resp.status !== 0){
            return fail(resp.message);
          }
          moduleIndex._stat.indexLastUpdateTime = Date.now();
          if(resp.data.curVer > ver){
            resp.data.indexs.forEach((indexItem) => {
              var indexKey = this.buildIndexKey(indexItem);
              if(indexKey && indexItem.metaId){
                moduleIndex[indexKey]=indexItem.metaId;
                delete metaCache[indexItem.metaId]; //增量更新，这里说明有变更，所以清除记录
                !moduleVerMap[indexItem.name] && (moduleVerMap[indexItem.name]=[]);
                moduleVerMap[indexItem.name].push(indexItem.ver);
              }
            });
            moduleIndex._stat.len = Object.keys(moduleIndex).length - 1;
            moduleIndex._stat.curVer = resp.data.curVer;
          }
          //设置了缓存的话有更新就一并更新cache
          activeFilecache && fileCache.setCache(indexCacheKey, JSON.stringify(moduleIndex));

          done(utils.clone(moduleIndex, ['_stat']));
        }).catch((err) => {
          logger.error(err);
          if(moduleIndex._stat.len > 0){
            logger.info('request fail use cache!');
            done(utils.clone(moduleIndex, ['_stat']));
          }else{
            fail(e);
          }
        });
      }
    })
  }
  findModule(name){
    return new Promise((done, fail) => {
      this.sendRequest('GET', 'index', (name && ('name='+name)) || '').then((resp) => {
        if(resp && resp.status == 0){
          var ret = {};
          resp.data.indexs.forEach((item) => {
            !ret[item.name] && (ret[item.name]=[]);
            ret[item.name].push(item.ver);
          });
          
          done(ret);
        }else{
          fail(resp && resp.message);
        }
      });
    })
  }
  buildIndexKey(indexItem){
    if(indexItem.name && indexItem.ver){
      return indexItem.name+'#'+indexItem.ver;
    }
    return null;
  }
  splitIndexKey(indexKey){
    if(indexKey){
      return indexKey.split('#');
      //return {name: name, ver:ver};
    }
  }
  getInfoFromSvn(fpath){
    return new Promise((done, fail) => {
      //logger.debug(fpath);
      fpath = path.resolve(fpath);
      //logger.debug(fpath);
      if(fs.existsSync(fpath)){
        svn.info(fpath, {}, (e, data) => {
          //logger.debug(data);
          assert.equal(e, null);
          var metaInfo = data.info.entry;
          var ftype = metaInfo._attribute.kind;
          if(ftype !== 'file'){
            fail('file type ' + ftype + 'not support now!');
          }
          var ret = {
            type: 'svn',
          };
          ret.url = metaInfo.url._text;
          ret.submiter = metaInfo.commit.author._text;
          ret.date = new Date(metaInfo.commit.date._text).getTime();
          ret.curRevision = metaInfo.commit._attribute.revision;
          done(ret);
        })
      }else{
        fail('path not exist!');
      }
    })
  }
  prevSubmit(fpath, name, ver, submiter, desc){
    return new Promise((done, fail) => {
      !name && (name=path.basename(fpath).replace(path.extname(fpath), ''));
      if(!/^http/.test(fpath)){ //本地文件
        this.getInfoFromSvn(fpath).then((metaInfo) => {
          metaInfo.desc = desc;
          submiter && (metaInfo.submiter = submiter);
          this.submitModule(name, ver, metaInfo).then((data) => {
            if(data){
              done('add success!');
            }else{
              done('update success!');
            }
          }).catch((err)=>{fail(err)});;
        }).catch((err) => {
          logger.error(err);
          fail('获取svn 信息失败！');
        })
      }else{
        var metaInfo = {
          type: 'http',
          url: fpath,
          submiter: submiter,
          desc: desc || '',
          date: Date.now()
        }
        this.submitModule(name, ver, metaInfo).then((data) => {
          if(data){
              done('add success!');
            }else{
              done('update success!');
            }
        }).catch((err)=>{fail(err)});
      }
    });
  }
  submitModule(name, ver, metaInfo){
    return new Promise((done, fail) => {
      var moduleVerMap = utils.clone(this.stat.moduleIndex._stat.moduleVerMap);
      this.updateIndex().then((indexMap) => {
        if(!ver){//对存在的module自增版本号，否则为1.00
          if(moduleVerMap.hasOwnProperty(name)){
            var lastVer = moduleVerMap[name].pop().split('.');
            lastVer[1] = !lastVer[1] ? 1 : (parseInt(lastVer[1])+1);
            ver = lastVer.join('.'); 
          }else{
            ver = '1.0';
          }
        }
        var indexKey = this.buildIndexKey({name: name, ver: ver});
        if(indexMap.hasOwnProperty(indexKey)){
          this.sendRequest('PUT', 'module', {
            orgname: name,
            orgver: ver,
            meta: JSON.stringify(metaInfo)
          }).then((resp) => {
            if(resp && resp.status == 0){
              done(resp.data);
            }else{
              fail(resp && resp.message);
            }
          }).catch((err)=>{fail(err)});;
        }else{
          this.sendRequest('POST', 'module', {
            name: name,
            ver: ver,
            meta: JSON.stringify(metaInfo)
          }).then((resp) => {
            if(resp && resp.status == 0){
              done();
            }else{
              fail(resp && resp.message);
            }
          }).catch((err)=>{fail(err)});;
        }
      }).catch((err)=>{fail(err)});
    })
  }
  getModuleByIds(ids){
    return new Promise((done, fail) => {
      var retMap = {};
      var {activeFilecache, metaInfosCacheKey} = this.cnf;
      var metaCache = this.stat.metaCache;
      ids = utils._type(ids) === 'string' ? [ids] : utils.clone(ids);
      
      ids.splice(0,ids.length).forEach((id) => {
        var metas = metaCache[id];
        if(metas && metas.url && metas.type){
          retMap[id] = {
            type: metas.type,
            url: metas.url
          }
        }else{
          ids.push(id);
        }
      });
      logger.debug('get from cache:',retMap);
      if(ids.length > 0){
        // logger.debug('start get new ids:',ids);
        this.sendRequest('GET', 'module', 'metaId='+ids.join(',')).then((resp) => {
          //logger.debug(resp)
          if(!resp || resp.status !== 0){
            return fail(resp.message);
          }
          resp.data.forEach((item) => {
            metaCache[item.id] = item;
            item.curRevision && (item.url+='@'+item.curRevision);
            retMap[item.id] = {
              type: item.type,
              url: item.url
            }
          });
          activeFilecache && fileCache.setCache(metaInfosCacheKey, JSON.stringify(metaCache));
          done(retMap);
        }).catch((err) => {fail(err)});
      }else{
        done(retMap);
      }
    })
  }
  getModule(name, ver){
    return new Promise((done, fail) => {
      var indexKey = this.buildIndexKey({name: name, ver: ver});
      this.updateIndex().then((indexMap) => {
        if(indexMap.hasOwnProperty(indexKey)){
          var metaId = indexMap[indexKey];
          this.getModuleByIds(metaId).then((retMap) => {
            if(retMap.hasOwnProperty(metaId)){
              done(retMap[metaId]);
            }else{
              done(null);
            }
          }).catch((err) => {fail(err)});;
        }else{
          done(null);
        }
      }).catch((err) => {fail(err)});
    });
  }
}

module.exports = new ModuleClient();