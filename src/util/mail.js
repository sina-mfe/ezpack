"use strict"
var mailer = require('emailjs');

var mailCnf = {
  user: 'yfhe2coder@163.com',
  pw: 'yfhe#*3408661',
  name: 'yuanfeng<yfhe2coder@163.com>',
  host: 'smtp.163.com',
  ssl: true,
}

class SendMail{
  constructor(cnf) {
    this.server = mailer.server.connect({
      user: mailCnf.user,
      password: mailCnf.pw,
      host: mailCnf.host,
      ssl: mailCnf.ssl,
    });
    this.messager = {};

  }
  registerMessager(name, uri, cover) {
    if(!this.messager.hasOwnProperty(name) || cover){
      this.messager[name] = uri;
    }
  }
  send(users, title, content, callback) {
    this.server.send({
      from: mailCnf.name,
      text: content,
      subject: title,
      to: users.map((name) => {return `${name}<${this.messager[name]}>`}).join(',')
    }, callback);
  }
}

module.exports = new SendMail();
