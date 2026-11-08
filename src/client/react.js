/**
 * 浏览器模块表里的 React。
 *
 * 客户端产物由 `window.__ModuleLoader__.load({ factory(require) })` 执行，React 由宿主提供
 * （`require('react')`），插件不自带一份。所有组件统一从这里取 `h` / hooks，不要再各自
 * `import react`——打包时 `react` 是 external，最终仍然落到 factory 的 `require` 上。
 */
import * as React from 'react'

export const h = React.createElement
export const Fragment = React.Fragment
export const useState = React.useState
export const useEffect = React.useEffect
export const useCallback = React.useCallback
export const useRef = React.useRef
export const useMemo = React.useMemo
