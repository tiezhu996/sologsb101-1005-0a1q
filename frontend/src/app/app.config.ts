import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { appRoutes } from './core/router/app.routes';
import { bridgeReducer } from './core/store/bridge.reducer';
import { bearingReducer } from './core/store/bearing.reducer';
import { stepReducer } from './core/store/step.reducer';
import { acceptanceReducer } from './core/store/acceptance.reducer';
import { AppEffects } from './core/store/app.effects';

/**
 * 应用配置：路由 + Angular Material 动画 + NgRx store / effects。
 * 结构与提示词「五、文件结构强制清单」一致。
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // 默认 PathLocationStrategy（history 模式）：与 nginx `try_files $uri $uri/ /index.html` 配合，
    // 直接访问 /bridges、/readings 等深链接可命中对应页面并支持刷新
    provideRouter(appRoutes, withComponentInputBinding()),
    provideAnimationsAsync(),
    provideStore({
      bridge: bridgeReducer,
      bearing: bearingReducer,
      step: stepReducer,
      acceptance: acceptanceReducer,
    }),
    provideEffects([AppEffects]),
    provideStoreDevtools({ maxAge: 25, logOnly: !isDevMode() }),
  ],
};
