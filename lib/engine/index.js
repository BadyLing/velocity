var fs = require('fs')
var path = require('path')

var util = require('../util')
var logger = require('../logger')
var handleCfg = require('../handle-cfg')

var parser = require('./velocity')
var eutil = require('./engine-util')
var STATS = require('./engine-stats')

function Engine(cfg) {
  this.cfg = handleCfg(cfg)

  // help to position semantic error
  // only the root template could not be a file
  // {__parent: x, isFile: x, raw: x, relPath: x, fullPath: x}
  this.template = this.cfg.template
  // ast cache
  this.ast = {/*fullPath: astCache*/}
  // global macro ast
  this.macro = {}
  if (this.cfg.macro) {
    this.getMacro(this.cfg.macro)
  }
}

// process global macro
Engine.prototype.getMacro = function(obj) {
  var that = this
  var content = obj.isFile ? fs.readFileSync(obj.fullPath, {encoding: this.cfg.encoding}) : obj.raw
  var ast = parser.parse(content)
  ast.body.forEach(function(node){
    if (node.type === 'Macro') {
      that.Macro(node, true)
    }
  })
  // logger.debug('Macro', this.macro)
}

/////////////////////////////
// THE ONLY PUBLICK METHOD //
/////////////////////////////
Engine.prototype.render = function(context) {
  if (!context) {
    logger.error('context is required.')
  }
  // TODO: if success, return result string, or throw exception
  return this.Render(context)
}

Engine.prototype.pushContext = function(context) {
  if (!this.context) {
    context.__macro = util.mix(null, this.macro)
    this.topContext = context
  }
  context.__parent = this.context
  this.context = context
  // logger.debug('Push context.', this.context)
}

Engine.prototype.popContext = function() {
  this.context = this.context.__parent
  // logger.debug('Pop context.', this.context)
}

Engine.prototype.pushTemplate = function(template) {
  template.__parent = this.template
  this.template = template
}

Engine.prototype.popTemplate = function() {
  this.template = this.template.__parent
}

Engine.prototype.get = function(key) {
  var ctx = this.context
  for (ctx; ctx; ctx = ctx.__parent) {
    if (ctx[key]) return ctx[key]
  }
  return undefined
}

Engine.prototype.Render = function(context, template) {
  if (context) this.pushContext(context)
  if (template && template.isFile) this.pushTemplate(template)

  var templ = template || this.template
  var node
  if (templ.isFile) {
    if (!templ.fullPath) {
      templ.fullPath = util.getFullPath(templ.relPath, this.cfg.roots)
    }
    if (templ.fullPath) {
      // TODO: content and ast cache
      var content = fs.readFileSync(templ.fullPath, {encoding: this.cfg.encoding})
      templ.lines = content.split(require('os').EOL)
      node = parser.parse(content)
    } else {
      // TODO: need confirm
      return {
        stats: STATS.FAIL,
        message: 'Template not exists or not subpath of roots.',
        template: this.template,
        pos: template.pos
      }
    }
  } else {
    node = parser.parse(template.raw)
  }

  // logger.debug('Ast', node)
  var rt = this[node.type](node)

  if (template && template.isFile) this.popTemplate(template)
  if (context) this.popContext(context)

  return rt
}

// bellow are ast processors
Engine.prototype.Statements = function(node) {
  var result = eutil.initResult()
  for (var i = 0; i < node.body.length; i++) {
    var cnode = node.body[i]
    var cresult = this[cnode.type](cnode)
    result = eutil.mergeResult(result, cresult)
    if (result.stats !== STATS.SUCCESS) break
  }
  return result
}

util.mix(
  Engine.prototype,
  require('./engine-ref'),
  require('./engine-expr'),
  require('./engine-direc')
)

module.exports = Engine






