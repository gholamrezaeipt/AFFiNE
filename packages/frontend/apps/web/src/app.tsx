import { AffineContext } from '@affine/component/context';
import { GlobalLoading } from '@affine/component/global-loading';
import { AppFallback } from '@affine/core/components/affine/app-container';
import { Telemetry } from '@affine/core/components/telemetry';
import { router } from '@affine/core/desktop/router';
import { configureCommonModules } from '@affine/core/modules';
import { configureLocalStorageStateStorageImpls } from '@affine/core/modules/storage';
import { CustomThemeModifier } from '@affine/core/modules/theme-editor';
import { configureIndexedDBUserspaceStorageProvider } from '@affine/core/modules/userspace';
import { configureBrowserWorkbenchModule } from '@affine/core/modules/workbench';
import {
  configureBrowserWorkspaceFlavours,
  configureIndexedDBWorkspaceEngineStorageProvider,
} from '@affine/core/modules/workspace-engine';
import createEmotionCache from '@affine/core/utils/create-emotion-cache';
import { createI18n, setUpLanguage } from '@affine/i18n';
import { CacheProvider } from '@emotion/react';
import {
  Framework,
  FrameworkRoot,
  getCurrentStore,
  LifecycleService,
} from '@toeverything/infra';
import { Suspense, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

const cache = createEmotionCache();

const future = {
  v7_startTransition: true,
} as const;

async function loadLanguage() {
  const i18n = createI18n();
  document.documentElement.lang = i18n.language;

  await setUpLanguage(i18n);
}

let languageLoadingPromise: Promise<void> | null = null;

const framework = new Framework();
configureCommonModules(framework);
configureBrowserWorkbenchModule(framework);
configureLocalStorageStateStorageImpls(framework);
configureBrowserWorkspaceFlavours(framework);
configureIndexedDBWorkspaceEngineStorageProvider(framework);
configureIndexedDBUserspaceStorageProvider(framework);
const frameworkProvider = framework.provider();

// setup application lifecycle events, and emit application start event
window.addEventListener('focus', () => {
  frameworkProvider.get(LifecycleService).applicationFocus();
});

frameworkProvider.get(LifecycleService).applicationStart();

const UseDetectTextDirection = (): void => {
  useEffect(() => {
    const detectTextDirection = (element: Element): void => {
      const text = element.textContent || '';

      // eslint-disable-next-line sonarjs/no-collapsible-if
      if (
        /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
          text
        )
      ) {
        if (element instanceof HTMLElement) {
          element.style.direction = 'rtl';
          element.style.textAlign = 'right';
        }
      }
    };

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          const elements = document.querySelectorAll('v-line');

          elements.forEach(element => {
            detectTextDirection(element);
          });
        }
      });
    });

    const config: MutationObserverInit = {
      childList: true,
      subtree: true, // Observe all child nodes
    };

    // Start observing the target node (e.g., document.body)
    if (document.body) {
      observer.observe(document.body, config);
    }

    // Cleanup function
    return () => {
      observer.disconnect();
    };
  }, []);
};

export function App() {
  if (!languageLoadingPromise) {
    languageLoadingPromise = loadLanguage().catch(console.error);
  }

  UseDetectTextDirection();

  return (
    <Suspense>
      <FrameworkRoot framework={frameworkProvider}>
        <CacheProvider value={cache}>
          <AffineContext store={getCurrentStore()}>
            <Telemetry />
            <CustomThemeModifier />
            <GlobalLoading />
            <RouterProvider
              fallbackElement={<AppFallback key="RouterFallback" />}
              router={router}
              future={future}
            />
          </AffineContext>
        </CacheProvider>
      </FrameworkRoot>
    </Suspense>
  );
}
