'use strict'

window.Studio = window.Studio || {}
window.Studio.fieldComponents = window.Studio.fieldComponents || new Map()
window.Studio.viewComponents = window.Studio.viewComponents || new Map()

window.Studio.registerFieldComponent = function registerFieldComponent(id, renderer) {
  window.Studio.fieldComponents.set(id, renderer)
}

window.Studio.registerViewComponent = function registerViewComponent(id, renderer) {
  window.Studio.viewComponents.set(id, renderer)
}
