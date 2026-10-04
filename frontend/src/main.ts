import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((error) => {
  // 启动失败时输出到控制台，便于容器环境排查
  console.error('应用启动失败', error);
});
