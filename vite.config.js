import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
        manage: 'manage.html',
        rvPark: 'rv-park.html',
        tentCamping: 'tent-camping.html',
      },
    },
  },
});
