import{defineConfig}from'vite';export default defineConfig({build:{target:'es2023',outDir:'dist'},worker:{format:'es'},server:{host:'0.0.0.0',allowedHosts:['terminal.local']}});
