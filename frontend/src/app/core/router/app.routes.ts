/**
 * 路由表（路径与项目提示词逐字一致）
 * /bridges、/bearings、/steps、/readings、/acceptances
 * 组件按路由懒加载，构建时自动分包。
 */
import type { Routes } from '@angular/router';

/** 路由常量：页面跳转统一引用，避免硬编码字符串 */
export const ROUTES = {
  bridges: '/bridges',
  bearings: '/bearings',
  steps: '/steps',
  readings: '/readings',
  acceptances: '/acceptances',
} as const;

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: ROUTES.bridges },
  {
    path: 'bridges',
    title: '桥梁与墩台',
    loadComponent: () =>
      import('../../features/bridges/pages/bridge-list.page').then((module) => module.BridgeListPage),
  },
  {
    path: 'bearings',
    title: '支座与评级',
    loadComponent: () =>
      import('../../features/bearings/pages/bearing-board.page').then((module) => module.BearingBoardPage),
  },
  {
    path: 'steps',
    title: '顶升步骤编排',
    loadComponent: () =>
      import('../../features/steps/pages/step-plan.page').then((module) => module.StepPlanPage),
  },
  {
    path: 'readings',
    title: '测点读数录入',
    loadComponent: () =>
      import('../../features/readings/pages/reading-entry.page').then((module) => module.ReadingEntryPage),
  },
  {
    path: 'acceptances',
    title: '分步验收与归档',
    loadComponent: () =>
      import('../../features/acceptances/pages/acceptance-archive.page').then(
        (module) => module.AcceptanceArchivePage,
      ),
  },
  { path: '**', redirectTo: ROUTES.bridges },
];
