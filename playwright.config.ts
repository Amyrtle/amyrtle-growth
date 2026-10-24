import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:45000,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:4174',channel:'msedge',headless:true,screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run start',url:'http://127.0.0.1:4174/api/health',reuseExistingServer:false,timeout:60000,env:{PORT:'4174',PUBLIC_ORIGIN:'http://127.0.0.1:4174',DATABASE_PATH:`.local/e2e-${Date.now()}.sqlite`,DEMO_MODE:'true'}},
});
