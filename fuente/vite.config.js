import { defineConfig } from 'vite';

// Rutas relativas: el atlas funciona igual en la raíz del dominio
// que dentro de una subcarpeta tipo /madrid-subterraneo/.
export default defineConfig({ base: './', build: { outDir: 'dist' } });
