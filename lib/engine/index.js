var fs = require('fs')
var path = require('path')
var parser = require('./velocity')
var util = require('../util')
var logger = require('../logger')
var handleCfg = require('../handle-cfg')

function Engine(cfg) {
  this.cfg = handleCfg(cfg)
  logger.debug('Config', this.cfg)

  // ast cache
  this.ast = {}
  // ast of global macro
  this.macro = {}
  if (this.cfg.macro) {
    this.macro = this.parseMacro(this.cfg.macro)
  }
}

Engine.prototype.parseMacro = function(file) {
  var macro = this.macro
  var ast = parser.parse(fs.readFileSync(file, {encoding: this.cfg.encoding}))
  ast.body.forEach(function(node){
    if (node.type === 'Macro') {
      if (node.name in macro) {
        logger.warn('Repeated macro definition.', {file: file, name: node.name})
      }
      macro[node.name] = node
    }
  })
  // logger.debug('Macro', macro)
}

/**
 * @param {Object} context
 * @param {String} template could be file path or content
 */
Engine.prototype.render = function(context, template) {
  if (!arguments.length) {
    logger.error('Context is required.')
  }

  if (context) {
    context.__parent = this.context
    this.context = context
  }

  template = template || this.cfg.template
  var fullPath = util.getFullPath(template, this.cfg.roots)
  var node

  // file path
  if (fullPath) {
    if (!(fullPath in this.ast)) {
      var content = fs.readFileSync(fullPath, {encoding: this.cfg.encoding})
      this.ast[fullPath] = parser.parse(content)
    }
    node = this.ast[fullPath]
  // content
  } else {
    node = parser.parse(template)
  }

  logger.debug('Ast', node)
  return this[node.type](node)
}

Engine.prototype.Statements = function(node) {
  var content = ''
  var body = node.body
  for (var i = 0; i < body.length; i++) {
    var cnode = body[i]
    content += this[cnode.type](cnode)
  }
  return content
}

Engine.prototype.Reference = function(node) {
  var obj = node.object
  var objv = this[obj.type](obj)

  if (objv.success) {
    return objv.value
  } else if (node.silent){
    return ''
  } else {
    var rt = '$'
    if (node.wrapped) rt += '{'
    rt += objv.literal
    if (node.wrapped) rt += '}'
    return rt
  }
}

Engine.prototype.Identifier = function(node) {
  var n = node.name
  var v = this.context[n]
  return {
    value: v,
    literal: n,
    success: v !== undefined
  }
}

Engine.prototype.Prop = function(node) {
  return node.name
}

Engine.prototype.Property = function(node) {
  var obj = node.object
  var objv = this[obj.type](obj)

  var prop = node.property
  var propv = this[prop.type](prop)

  var literal
  if (prop.type === 'Prop') {
    literal =  objv.literal + '.' + propv
  } else {
    literal =  objv.literal + '[' + quotes(propv) + ']'
  }

  var rt = {
    literal: literal,
    success: false
  }

  if (objv.success && objv.value !== null && propv) {
    var v = objv.value[propv]
    if (v !== undefined) {
      rt.value = v
      rt.success = true
    }
  }
  return rt
}

Engine.prototype.Index = Engine.prototype.Property

Engine.prototype.Method = function(node) {
  var that = this
  var callee = node.callee
  var calleev = this[callee.type](callee)

  var args = node.arguments
  var argsv = []
  args.forEach(function(arg) {
    argsv.push(that[arg.type](arg))
  })

  var rt = {
    literal: calleev.literal + '(' + quotes(argsv).join(', ') + ')',
    success: false
  }

  if (calleev.success && typeof calleev.value === 'function') {
    var v = calleev.value.apply(null, argsv)
    if (v !== undefined) {
      rt.value = v
      rt.success = true
    }
  }

  return rt
}

Engine.prototype.Range = function(context, node) {
  var start = node.start
  var startv = this[start.type](context, start)

  var end = node.end
  var endv = this[end.type](context, end)

  if (isInteger(startv) && isInteger(endv)) {
    return generateList(startv, endv)
  } else {
    return []
  }
}

Engine.prototype.List = function(context, node) {
  var that = this
  var rt = []
  node.elements.forEach(function(element) {
    rt.push(that[el.type](context, element))
  })
  return rt
}

Engine.prototype.Map = function(context, node) {
  var that = this
  var rt = {}
  node.mapItems.forEach(function(mapItem) {
    var key = mapItem.key
    var keyv = that[key.type](context, key)

    var value = mapItem.value
    var valuev = that(value.type)(context, value)

    rt[keyv + ''] = valuev
  })
  return rt
}

Engine.prototype.UnaryExpr = function(context, node) {
  var argument = node.argument
  var argumentv = this[argument.type](context, argument)
  return !argumentv
}

Engine.prototype.BinaryExpr = function(context, node) {
  var left = node.left
  var leftv = this[left.type](context, left)

  var right = node.right
  var rightv = this[right.type](context, right)

  var rt

  switch(node.operator) {
    case '*':
      rt = leftv * rightv
      break
    case '/':
      rt = leftv / rightv
      break
    case '%':
      rt = leftv % rightv
      break
    case '%':
      rt = leftv % rightv
      break
    case '+':
      rt = leftv + rightv
      break
    case '-':
      rt = leftv - rightv
      break
    case '>=':
      rt = leftv >= rightv
      break
    case '>':
      rt = leftv > rightv
      break
    case '<=':
      rt = leftv <= rightv
      break
    case '<':
      rt = leftv < rightv
      break
    case '==':
      rt = leftv == rightv
      break
    case '!=':
      rt = leftv != rightv
      break
    case '&&':
      rt = leftv && rightv
      break
    case '||':
      rt = leftv || rightv
      break
    default:
      break
  }

  return rt
}

Engine.prototype.AssignExpr = function(context, node) {
  var left = node.left
  var right = node.right
  var rightv = this[right.type](context, right)

  return rightv
}

Engine.prototype.DString = function(context, node) {
  return this.render(context, node.value)
}

Engine.prototype.Set = function(context, node) {
  var body = node.body
  this[body.type](context, body)
}

Engine.prototype.If = function(context, node) {

}

Engine.prototype.Foreach = function(context, node) {

}

Engine.prototype.Include = function(context, node) {

}

Engine.prototype.Parse = function(context, node) {

}

Engine.prototype.Evaluate = function(context, node) {

}

Engine.prototype.Define = function(context, node) {

}

Engine.prototype.Macro = function(context, node) {

}

Engine.prototype.MacroCall = function(context, node) {

}

Engine.prototype.Stop = function(context, node) {

}

Engine.prototype.Break = function(context, node) {

}


Engine.prototype.Boolean = literal
Engine.prototype.Null = literal
Engine.prototype.Integer = literal
Engine.prototype.Float = literal
Engine.prototype.String = literal
Engine.prototype.Text = literal
Engine.prototype.BText = literal

Engine.prototype.Comment = empty
Engine.prototype.BComment = empty


function literal(node) {
  return node.value
}

function empty(node) {
  return ''
}

function isInteger(v) {
  if (typeof v !== 'number') return false
  if (Math.floor(v) !== Math.ceil(v)) return false
  return true
}

// [0..3] -> [0, 1, 2, 3]
function generateList(start, end) {
  var rt = []
  var sign = start <= end ? 1 : -1
  var i
  for (i = start; i += sign; (i - end) * sign <= 0) {
    rt.push(i)
  }
  return rt
}

// 'string' -> "'string'"
// other    -> other
// ['string', 1, false] -> ["'string'", 1, false]
function quotes(input) {
  if (input.length && input.map) {
    return input.map(function(item) {
      return singleQuotes(item)
    })
  } else {
    return singleQuotes(input)
  }
}

function singleQuotes(input) {
  if (typeof input === 'string') {
    return "'" + input + "'"
  } else {
    return input
  }
}

module.exports = Engine






