import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { initDatabase } from './core/utils/db';
import { IdbTableService } from './core/services/idb-table.service';
import { appInit } from './core/store/app.actions';
import {
  selectBearingStats,
  selectBearings,
} from './core/store/bearing.selectors';
import { selectBridgeStats } from './core/store/bridge.selectors';
import { selectStepStats } from './core/store/step.selectors';
import { selectAcceptanceStats } from './core/store/acceptance.selectors';
import { ROUTES } from './core/router/app.routes';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
  ],
  template: `
    <mat-toolbar color="primary" class="app-toolbar">
      <mat-icon>architecture</mat-icon>
      <span class="app-title">桥梁支座更换与顶升监测台</span>
      <span class="app-sub">gbbridgebear</span>
      <span class="app-spacer"></span>
      @if (errorMessage()) {
        <mat-chip class="app-error-chip" highlighted>{{ errorMessage() }}</mat-chip>
      }
      <mat-chip-set>
        <mat-chip highlighted>桥梁 {{ bridgeStats().total }} 座</mat-chip>
        <mat-chip highlighted>待换支座 {{ bearingStats().pending }} 个</mat-chip>
        <mat-chip highlighted>顶升级数 {{ stepStats().total }}</mat-chip>
        <mat-chip highlighted>验收合格 {{ acceptanceStats().pass }} 条</mat-chip>
      </mat-chip-set>
    </mat-toolbar>

    <mat-sidenav-container class="app-shell">
      <mat-sidenav mode="side" opened class="app-sidenav">
        <div class="app-brand">
          <div class="app-brand-title">顶升监测作业台</div>
          <div class="app-brand-sub">墩台编排 · 逐步顶升 · 分步验收</div>
        </div>
        <mat-divider></mat-divider>
        <mat-nav-list>
          @for (item of navItems; track item.path) {
            <a
              mat-list-item
              [routerLink]="item.path"
              routerLinkActive="is-active"
              [routerLinkActiveOptions]="{ exact: false }"
            >
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
        <mat-divider></mat-divider>
        <div class="app-sidenav-foot">
          <div>桥梁 {{ bridgeStats().total }} 座 · 墩台 {{ bridgeStats().piers }} 个</div>
          <div>支座 {{ bearingStats().total }} 个（较重 {{ bearingStats().moderate }} · 严重 {{ bearingStats().severe }}）</div>
          <div>累计顶升 {{ stepStats().cumulativeMm }} mm · 测点 {{ stepStats().readingCount }} 条</div>
          <div>验收 {{ acceptanceStats().total }} 条（不合格 {{ acceptanceStats().fail }}）</div>
        </div>
      </mat-sidenav>

      <mat-sidenav-content class="app-content">
        <div class="app-body">
          <router-outlet />
        </div>
        <div class="app-foot">
          数据仅保存在本机浏览器 IndexedDB（库名 gbbridgebear）· 纯前端 SPA，无后端与外部接口
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [
    `
      .app-toolbar {
        gap: 10px;
        flex-wrap: wrap;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .app-title {
        font-size: 16px;
        font-weight: 600;
      }
      .app-sub {
        font-size: 12px;
        opacity: 0.75;
      }
      .app-spacer {
        flex: 1 1 auto;
      }
      .app-error-chip {
        background: #ffebee !important;
        color: #b71c1c !important;
      }
      .app-shell {
        height: calc(100vh - 64px);
        background: var(--gb-bg);
      }
      .app-sidenav {
        width: 248px;
        background: #0f1f33;
        color: #e3ecf7;
      }
      .app-sidenav ::ng-deep .mat-mdc-list-item {
        color: #e3ecf7;
      }
      .app-sidenav ::ng-deep .mat-mdc-list-item.is-active {
        background: rgba(21, 101, 192, 0.32);
      }
      .app-brand {
        padding: 16px;
      }
      .app-brand-title {
        font-size: 15px;
        font-weight: 600;
      }
      .app-brand-sub {
        font-size: 12px;
        opacity: 0.65;
        margin-top: 4px;
      }
      .app-sidenav-foot {
        padding: 14px 16px 24px;
        font-size: 12px;
        line-height: 1.9;
        opacity: 0.7;
      }
      .app-content {
        background: var(--gb-bg);
      }
      .app-body {
        padding: 18px;
      }
      .app-foot {
        text-align: center;
        padding: 12px;
        font-size: 12px;
        color: rgba(22, 34, 46, 0.45);
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly idb = inject(IdbTableService);
  private readonly destroyRef = inject(DestroyRef);

  readonly navItems: NavItem[] = [
    { path: ROUTES.bridges, label: '桥梁与墩台', icon: 'foundation' },
    { path: ROUTES.bearings, label: '支座与评级', icon: 'view_module' },
    { path: ROUTES.steps, label: '顶升步骤编排', icon: 'stairs' },
    { path: ROUTES.readings, label: '测点读数录入', icon: 'monitor_heart' },
    { path: ROUTES.acceptances, label: '分步验收与归档', icon: 'fact_check' },
  ];

  /** 顶栏与侧栏统计：全部来自 NgRx select */
  readonly bridgeStats = toSignal(this.store.select(selectBridgeStats), {
    initialValue: { total: 0, piers: 0, bearings: 0, pending: 0, severe: 0, archived: 0 },
  });
  readonly bearingStats = toSignal(this.store.select(selectBearingStats), {
    initialValue: { total: 0, intact: 0, slight: 0, moderate: 0, severe: 0, pending: 0 },
  });
  readonly stepStats = toSignal(this.store.select(selectStepStats), {
    initialValue: {
      total: 0,
      cumulativeMm: 0,
      arrived: 0,
      lifting: 0,
      idle: 0,
      readingCount: 0,
      maxLimitMm: 0,
    },
  });
  readonly acceptanceStats = toSignal(this.store.select(selectAcceptanceStats), {
    initialValue: { total: 0, pass: 0, fail: 0, byStage: [] },
  });

  /** 错误提示（写入失败等） */
  readonly errorMessage = toSignal(
    this.store.select((state) => ({
      bridge: state.bridge.error,
      bearing: state.bearing.error,
      step: state.step.error,
      acceptance: state.acceptance.error,
    })).pipe(map((errors) => errors.bridge || errors.bearing || errors.step || errors.acceptance)),
    { initialValue: '' },
  );

  constructor() {
    // 订阅变更广播：任何页面写入后自动触发全量重载
    this.idb
      .watch(async () => true, true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.store.dispatch(appInit()));
  }

  async ngOnInit(): Promise<void> {
    // 首屏：打开 IndexedDB 并按需播种演示数据，然后由 effect 拉取全部表
    await initDatabase();
    this.store.dispatch(appInit());
  }
}
