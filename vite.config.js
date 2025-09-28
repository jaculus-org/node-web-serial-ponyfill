import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import banner from 'vite-plugin-banner'
import { version, author } from './package.json'

const name = "Node Web Serial Ponyfill";

const licenseBanner = `/*
${name} v${version}
Copyright 2022${new Date().getFullYear() > 2022 ? '-' + new Date().getFullYear() : ''} ${author}
*/`

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      name: name,
      formats: ['es', 'cjs'],
      fileName: (format) => `node-web-serial-ponyfill.${format === 'es' ? 'es' : 'cjs'}.js`
    },
    rollupOptions: {
      external: ['serialport', 'web-streams-polyfill', '@types/dom-serial', 'jiti']
    },
    sourcemap: true
  },
  plugins: [
    dts({
      outDir: '.',
      insertTypesEntry: true
    }),
    banner({
      content: licenseBanner
    })
  ]
})