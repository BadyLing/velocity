var fs = require('fs')
var path = require('path')
var iconv = require('iconv-lite')
var common = require('totoro-common')

var util = require('../util')
var logger = require('../logger')
var handleCfg = require('../handle-cfg')

var parser = require('./velocity')
var STATS = require('./engine-stats')

function Engine(cfg) {
  this.cfg = handleCfg(cfg)

  // global macro
  this.macro = {}
  if (this.cfg.macro) {
    this.GMacro(this.cfg.macro)
  }
}

// process global macro
Engine.prototype.GMacro = function(m) {
  var that = this
  var content = m.isFile ? util.readFile(m.fullPath, this.cfg.encoding) : m.raw
  var ast = parser.parse(content)
  this.cfg.macro.lines = content.split(/\r?\n/)
  ast.body.forEach(function(node){
    if (node.type === 'Macro') {
      that.Macro(node, true)
    }
  })
  // logger.debug('Macro', this.macro)
}

////////////////////////////
// the only public method //
////////////////////////////
Engine.prototype.render = function(context) {
  if (!context) {
    logger.error('context is required.')
  }

  var result = this.Render(context)

  if (result.stats === STATS.SUCCESS || result.stats === STATS.STOP) {
    return {
      success: true,
      value: result.value
    }

  } else {
    var origin = result.stack[0]
    var originTempl = origin[0]
    var originPos = origin[1]

    return {
      success: false,
      message: result.message || 'Illegal #break.',
      stack: result.stack.map(function(item){
        var template = item[0]
        var file = template.fullPath || trim(template.raw)
        var pos = item[1]
        return [file, pos]
      }),
      lines: originTempl.lines.filter(function(line, idx) {
        return idx + 1 >= originPos.first_line && idx + 1 <= originPos.last_line
      }),
      pos: originPos
    }
  }
}


Engine.prototype.pushContext = function(context) {
  if (!this.context) {
    this.topContext = context
  }
  context.__parent = this.context
  this.context = context
  // logger.debug('Push context', this.context)
}

Engine.prototype.popContext = function() {
  this.context = this.context.__parent
  // logger.debug('Pop context', this.context)
}

Engine.prototype.pushTemplate = function(template) {
  // ogger.debug('Push template', template.raw)
  template.__history = template.history || []
  if (template.__parent) {
    template.__history.push(template.__parent)
  }
  template.__parent = this.template
  template.__macro = {}
  this.template = template
}

Engine.prototype.popTemplate = function() {
  // logger.debug('Pop template', this.template.raw)
  var templ = this.template
  var newTop = templ.__parent
  templ.__parent = templ.__history.pop()
  this.template = newTop
}

// get value from context chain
Engine.prototype.get = function(key) {
  var ctx = this.context
  for (ctx; ctx; ctx = ctx.__parent) {
    if (ctx[key] !== undefined) return ctx[key]
  }
  return undefined
}

Engine.prototype.Render = function(context, template) {
  var that = this
  var templ = template || this.cfg.template
  var node

  if (context) this.pushContext(context)
  // very time call this method will pass template in
  // except the first time called by .render()
  if (!template || template.isFile) this.pushTemplate(templ)

  var content = templ.raw
  if (templ.isFile) {
    var buf = fs.readFileSync(templ.fullPath)
    content = iconv.decode(buf, this.cfg.encoding)
  }

  node = parser.parse(content)
  templ.lines = content.split(/\r?\n/)

  // logger.debug('Ast', node)
  var rt = this[node.type](node)

  if (!template || template.isFile) this.popTemplate()
  if (context) this.popContext()

  return rt
}

// bellow are ast processors
Engine.prototype.Statements = function(node) {
  var result = this.initSuccessInfo()

  for (var i = 0; i < node.body.length; i++) {
    var cn = node.body[i]
    var cr = this[cn.type](cn)
    if (cr.stats === STATS.SUCCESS) {
      result.value += cr.value
    } else {
      this.mergeResult(result, cr)
      break
    }
  }
  return result
}

common.mix(
  Engine.prototype,
  require('./engine-ref'),
  require('./engine-expr'),
  require('./engine-direc')
)


// bellow are some assistant methods
Engine.prototype.initSuccessInfo = function() {
  return {
    stats: STATS.SUCCESS,
    value: ''
  }
}

Engine.prototype.initFailInfo = function(msg, pos) {
  return {
    stats: STATS.FAIL,
    value: '',
    message: msg,
    stack: [[this.template, pos]]
  }
}

// merge not successful result
Engine.prototype.mergeResult = function(target, src) {
  target.stats = src.stats
  target.value += src.value
  target.stack = src.stack
  if (src.stats === STATS.FAIL)
    target.message = src.message
}

function trim(str) {
  var len = str.length
  var str = str.substr(0, 40).replace(/\n/g, '\\n')
  if (len > 40) str += '...'
  return str
}

module.exports = Engine






