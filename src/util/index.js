"use strict"
var fs = require('fs');
var path = require('path');
var log4js = require('log4js');
var logger = log4js.getLogger(path.basename(__filename))

var APICODE = require('./apiCode');
//var MongoDB = require('./mongoClient');

class EventFactory{
  constructor(){
    this.eventMap = {};
  }
  _initEvent(live=false){
    return {
      listener: [], // {func: Function, liveIndex: 0}
      isLive: live,
      liveEvents: [],
    };
  }
  _addListener(eventObj, listenFunc){
    var listenerProxy = eventObj.listener,
      exist = false,
      listenObj = {};
    exist = !listenerProxy.every((tmp) => {
      if(tmp.func !== listenFunc){
        return true;
      }else{
        listenObj = tmp;
        return false;
      }
    });
    if(!exist){
      listenObj = {
        func: listenFunc,
        liveIndex: 0,
      };
      listenerProxy.push(listenObj);
    }
    return listenObj;
  }
  on(eventName, func, isLive=false){
      var eventObj, listenerObj;
      eventMap = this.eventMap;
      if(!eventMap.hasOwnProperty(eventName)){
        eventMap[eventName] = this._initEvent(isLive);
      }
      eventObj = eventMap[eventName];
      listenObj = this._addListener(eventMap[eventName], func);
      if(isLive && eventObj.liveEvents.length > 0 && listenObj.liveIndex < eventObj.liveEvents.length){
        listenObj.liveIndex = eventObj.liveEvents.length;
        var i=listenObj.liveIndex,
          len = eventObj.liveEvents.length;
        eventObj.liveIndex = len;
        for(;i<len;i++){
          eventObj.func.apply(window, eventObj.liveEvents[i]);
        }
      }
    }
    trigger(eventName, params, isLive=true){
      //isLive = typeof(isLive) === 'boolean' ? isLive : true;
      var eventObj;
      eventMap = this.eventMap; 
      if(!eventMap.hasOwnProperty(eventName)){
        eventObj = eventMap[eventName] = this._initEvent(isLive);
        eventObj.liveEvents.push(params);
      }else{
        eventObj = eventMap[eventName];
        eventObj.listener.forEach((listenObj) => {
          try{
            listenObj.func.apply(window, params);
          }catch(err){
            console.error && console.error(err);
          }
        });
        isLive && eventObj.liveEvents.push(params);
      }
    }
}


class FileCache{
  constructor(storePath, maxCacheLen, maxCacheTime, stateUpdateInterval){
    this.cnf = {
      ignoreKey: ['.','..'],
      storePath: path.resolve(storePath),
      maxCacheLen: maxCacheLen || [50, 60],
      maxCacheTime: (maxCacheTime || 36000)*1000,
      stateUpdateInterval: (stateUpdateInterval || 600)*1000
    };
    this.state = {
      lastCheck: Date.now(),
      keyCache: []
    };
    if(!fs.existsSync(this.cnf.storePath)){
      fs.mkdirSync(this.cnf.storePath);
    }
    //初始化清除原有的缓存
    //this.clearCache();
    
    //强制更新key缓存
    this.updateCacheKeys(true);
  }
  clearCache(key){
    var cnf = this.cnf;
    var targets = [];
    if(!key){
      //清除所有缓存, 直接遍历目标目录
      fs.readdirSync(cnf.storePath).forEach((item) => {
        cnf.ignoreKey.indexOf(item) === -1 && targets.push(item);
      });
    }else{
      if(fs.existsSync(path.join(cnf.storePath, key))){
        targets.push(key);
      }else{
        //key不存在则忽略
        return null;
      }
    }
    targets.forEach((item) => {
      try{
        fs.unlinkSync(path.join(cnf.storePath, item));
      }catch(err){
        console.error(err);
      }
    });
  }
  reduceKeyCount(){
    var cnf = this.cnf;
    var stat = this.state;
    var leftKeyMap = [];
    console.log('start reduce key!');
    stat.keyCache.forEach((item) => {
      const curTime = Date.now();
      if(cnf.ignoreKey.indexOf(item) === -1){
        const tarPath = path.join(cnf.storePath, item);
        const cacheInfo = fs.lstatSync(tarPath);
        const mtime = cacheInfo.mtime && cacheInfo.mtime.getTime();
        if(mtime && (curTime - mtime) > cnf.maxCacheTime){
          try{
            fs.unlinkSync(tarPath);
          }catch(err){
            console.log();
          }
        }else{
          leftKeyMap.push({
            fpath: tarPath,
            mtime: mtime,
            key: item
          });
        }
      }
    });
    if(leftKeyMap.length > cnf.maxCacheLen[1]){
      leftKeyMap.sort((a,b) => {
        return b.mtime - a.mtime;
      });
      leftKeyMap.slice(cnf.maxCacheLen[0], leftKeyMap.length).forEach((item) => {
        try{
          fs.unlinkSync(item.fpath);
        }catch(err){
          console.log(err);
        }
      });
    }
    console.log('reduce done!');
    //裁剪完成后强制更新缓存key，避免因删除失败导致的key不同步;
    this.updateCacheKeys(true);
  }
  updateCacheKeys(isForece){
    var cnf = this.cnf;
    var state = this.state;
    console.log('update cache key'+state.keyCache.join());
    if(!isForece){
      const curTime = Date.now();
      if(curTime - state.lastCheck < cnf.stateUpdateInterval){
        console.log('ignore update');
        return;
      }
    }
    var allKeys = [];
    fs.readdirSync(cnf.storePath).forEach((item) => {
      cnf.ignoreKey.indexOf(item) === -1 && allKeys.push(item); 
    });
    state.keyCache = allKeys;
    console.log('update done key:'+allKeys.join());
  }
  getCache(key){
    console.log('start get cache: '+ key);
    if(key){
      let state = this.state;
      let cnf = this.cnf;
      this.updateCacheKeys();
      
      if(state.keyCache.length > cnf.maxCacheLen[1]){
        //超过最多限制进行裁剪
        this.reduceKeyCount();
      }
      if(state.keyCache.indexOf(key) !== -1){
        const targetPath = path.join(cnf.storePath, key);
        let keyInfo = fs.lstatSync(targetPath);
        if(!keyInfo.isDirectory()){
          const curTime = Date.now();
          let modifyTime = keyInfo.mtime && keyInfo.mtime.getTime();
          if(curTime - modifyTime < cnf.maxCacheTime){
            console.log(`start get content! file:${targetPath}`)
            return fs.createReadStream(targetPath, {
              encoding: 'utf-8'
            });
          }
          console.log(`file outdate! modi:${modifyTime} cur:${curTime}`);
        }
        console.log('key invalide!');
      }
      console.log('key dont exist!');
    }
    return null;
  }
  setCache(key, fsStream){
    if(key && fsStream){
      let state = this.state;
      let cnf = this.cnf;
      this.updateCacheKeys();
      if(state.keyCache.length > cnf.maxCacheLen[1]){
        //超过最多限制进行裁剪
        this.reduceKeyCount();
      }
      fs.writeFileSync(path.join(cnf.storePath, key), fsStream);
      state.keyCache.push(key);
      // fsStream.pipe(createWriteStream(path.join(cnf.storePath, key))).on('finish', () => {
      //   callback && callback();
      // });
    }
  }
}

class UitlTools extends EventFactory{
  constructor(){
    super();
  }
  extend(src, target, cover){
    cover = cover || false;
    for(var i in target){
      target.hasOwnProperty(i) && !src.hasOwnProperty(i) || cover ? src[i]=target[i] : '';
    }
  }
  filterSqlInsert(doc, blackList){
    return doc;
  }
  getParams(res, params, needs, options){
    try{
      logger.info(Object.keys(params), 'xxxx')
      needs = needs || [];
      options = options || [];
      var paramKeys = Object.keys(params);
      needs.forEach((attrs) => {
        var valid = false;
        attrs = this._type(attrs) === 'array' ? attrs : [attrs];
        attrs.forEach((attr) => {
            if(paramKeys.indexOf(attr) !== -1){
                valid = true;
            }
        });
        if(!valid){
          throw new TypeError('missing params '+ attrs.join(' or '));
        }
      });
      options.forEach((obj) => {
          if(paramKeys.indexOf(obj[0]) === -1){
              params[obj[0]] = obj[1];
          }
      });
      return true;
    }catch(err){
      //logger.error(err);
      var ret = {};
      switch(err.name.toLowerCase()){
          case 'typeerror':
              ret.status = APICODE.missingParams;
              ret.message = err.message;
          break;
          default:
              ret.status = APICODE.unknowError;
          break;
      }
      ret.message = err.message;
      res.send(ret);
    }
    return null;
  }
  clone(obj, blackList=[]){
    var ret = null;
    switch(this._type(obj)){
      case 'object':
        ret = {};
        Object.keys(obj).forEach((property) => {
          blackList.indexOf(property) === -1 && (ret[property] = this.clone(obj[property]));
        });
      break;
      case 'array':
        ret = [];
        obj.forEach((value) => {
          ret.push(this.clone(value));
        })
      break;
      default:
        ret = obj;
      break;
    }
    return ret;
  }
  _type(obj){
    var objType = typeof(obj)
    return objType !== 'object' ? objType : Object.prototype.toString.call(obj).toLowerCase().match(/\[object ([a-z]+)\]/)[1];
  }
}


module.exports = {
  utils: new UitlTools(),
  EventFactory: EventFactory,
  FileCache: FileCache,
  //MongoDB: MongoDB
};
