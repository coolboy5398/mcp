/**
 * AuthManager 页面池管理
 */

import { BrowserContext, Page } from 'playwright';
import { AuthLogger } from './logger.js';

/**
 * 页面池中的页面状态
 */
interface PooledPage {
    page: Page;
    inUse: boolean;
    lastUsed: number;
}

/**
 * 页面池统计信息
 */
export interface PagePoolStats {
    total: number;
    inUse: number;
    available: number;
    maxSize: number;
}

/**
 * 页面池管理器
 */
export class PagePoolManager {
    private readonly pagePool: PooledPage[] = [];
    private readonly pageWaitQueue: Array<(page: Page) => void> = [];

    constructor(
        private readonly contextProvider: () => Promise<BrowserContext>,
        private readonly pageTimeout: number,
        private readonly maxConcurrentPages: number,
        private readonly logger: AuthLogger,
    ) {}

    /**
     * 获取一个可用页面
     */
    async acquirePage(): Promise<Page> {
        const context = await this.contextProvider();

        for (const pooledPage of this.pagePool) {
            if (!pooledPage.inUse) {
                try {
                    pooledPage.page.url();
                    if (!pooledPage.page.isClosed()) {
                        pooledPage.inUse = true;
                        pooledPage.lastUsed = Date.now();
                        this.logger.log(`[DEBUG] acquirePage: 从池中获取空闲页面，当前池大小=${this.pagePool.length}`);
                        return pooledPage.page;
                    }
                } catch {
                    const index = this.pagePool.indexOf(pooledPage);
                    if (index > -1) {
                        this.pagePool.splice(index, 1);
                    }
                }
            }
        }

        if (this.pagePool.length < this.maxConcurrentPages) {
            const newPage = await context.newPage();
            newPage.setDefaultTimeout(this.pageTimeout);

            const pooledPage: PooledPage = {
                page: newPage,
                inUse: true,
                lastUsed: Date.now(),
            };
            this.pagePool.push(pooledPage);
            this.logger.log(`[DEBUG] acquirePage: 创建新页面，当前池大小=${this.pagePool.length}/${this.maxConcurrentPages}`);
            return newPage;
        }

        this.logger.log(`[DEBUG] acquirePage: 池已满(${this.pagePool.length}/${this.maxConcurrentPages})，等待页面释放...`);
        return new Promise<Page>((resolve) => {
            this.pageWaitQueue.push(resolve);
        });
    }

    /**
     * 归还页面
     */
    releasePage(page: Page): void {
        const pooledPage = this.pagePool.find(p => p.page === page);
        if (pooledPage) {
            pooledPage.inUse = false;
            pooledPage.lastUsed = Date.now();
            this.logger.log(`[DEBUG] releasePage: 页面已归还，当前使用中=${this.pagePool.filter(p => p.inUse).length}/${this.pagePool.length}`);

            if (this.pageWaitQueue.length > 0) {
                const resolve = this.pageWaitQueue.shift();
                if (resolve) {
                    pooledPage.inUse = true;
                    pooledPage.lastUsed = Date.now();
                    this.logger.log('[DEBUG] releasePage: 将页面分配给等待队列中的请求');
                    resolve(page);
                }
            }
            return;
        }

        this.logger.log('[DEBUG] releasePage: 页面不在池中，忽略');
    }

    /**
     * 获取页面池统计
     */
    getStats(): PagePoolStats {
        const inUse = this.pagePool.filter(p => p.inUse).length;
        return {
            total: this.pagePool.length,
            inUse,
            available: this.pagePool.length - inUse,
            maxSize: this.maxConcurrentPages,
        };
    }

    /**
     * 关闭页面池
     */
    async closeAll(): Promise<void> {
        for (const pooledPage of this.pagePool) {
            try {
                await pooledPage.page.close();
            } catch {
                // 忽略关闭错误
            }
        }
        this.pagePool.length = 0;
        this.pageWaitQueue.length = 0;
    }
}

/**
 * 创建页面池管理器
 */
export function createPagePoolManager(
    contextProvider: () => Promise<BrowserContext>,
    pageTimeout: number,
    maxConcurrentPages: number,
    logger: AuthLogger,
): PagePoolManager {
    return new PagePoolManager(contextProvider, pageTimeout, maxConcurrentPages, logger);
}
