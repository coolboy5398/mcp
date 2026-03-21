/**
 * 页面解析辅助函数
 */

import { Page } from 'playwright';
import {
    DocumentDetail,
    DocumentSummary,
    PartyInfo,
} from '../models/index.js';
import { NotFoundError } from '../errors/index.js';
import { PAGE_SELECTORS } from './selectors.js';

/**
 * 解析搜索结果
 */
export async function parseSearchResults(page: Page): Promise<DocumentSummary[]> {
    const results: DocumentSummary[] = [];

    console.error(`[DEBUG] parseSearchResults: 使用选择器 "${PAGE_SELECTORS.resultList}"`);
    const items = await page.$$(PAGE_SELECTORS.resultList);
    console.error(`[DEBUG] parseSearchResults: 找到 ${items.length} 个结果项`);

    for (const item of items) {
        const titleElement = await item.$(PAGE_SELECTORS.resultTitle);
        const courtElement = await item.$(PAGE_SELECTORS.resultCourt);
        const caseNoElement = await item.$(PAGE_SELECTORS.resultCaseNo);
        const dateElement = await item.$(PAGE_SELECTORS.resultDate);
        const typeElement = await item.$(PAGE_SELECTORS.resultType);
        const docIdInput = await item.$(PAGE_SELECTORS.resultDocIdInput);

        const 案件名称 = (await titleElement?.textContent())?.trim() ?? '';
        const 法院名称 = (await courtElement?.textContent())?.trim() ?? '';
        const 案号 = (await caseNoElement?.textContent())?.trim() ?? '';
        const 裁判日期 = (await dateElement?.textContent())?.trim() ?? '';
        const 案件类型 = (await typeElement?.textContent())?.trim() ?? '';

        const getDocId = async (): Promise<string> => {
            if (docIdInput) {
                const dataValue = await docIdInput.getAttribute('data-value');
                if (dataValue) {
                    console.error(`[DEBUG] parseResultItem: docId from data-value = ${dataValue.substring(0, 30)}...`);
                    return dataValue;
                }
            }

            const link = await item.$(PAGE_SELECTORS.resultTitle);
            if (link) {
                const href = await link.getAttribute('href');
                if (href) {
                    const docIdMatch = href.match(/docId=([^&]+)/);
                    if (docIdMatch && docIdMatch[1]) {
                        console.error(`[DEBUG] parseResultItem: docId from href = ${docIdMatch[1].substring(0, 30)}...`);
                        return docIdMatch[1];
                    }
                }
            }

            console.error('[DEBUG] parseResultItem: 使用临时 docId');
            return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        };

        const 文书ID = await getDocId();

        if (!案件名称 && !案号) {
            console.error('[DEBUG] parseResultItem: 案件名称和案号都为空，返回 null');
            continue;
        }

        results.push({
            文书ID,
            案件名称: 案件名称 || '未知案件',
            案号: 案号 || '未知案号',
            法院名称: 法院名称 || '未知法院',
            裁判日期: 裁判日期 || '未知日期',
            案件类型: 案件类型 || '未知类型',
        });
    }

    return results;
}

/**
 * 解析文书详情
 */
export async function parseDocumentDetail(page: Page, docId: string): Promise<DocumentDetail> {
    const 案件名称 = await extractText(page, PAGE_SELECTORS.documentTitle);
    const 案号 = await extractText(page, PAGE_SELECTORS.documentCaseNo);
    const 法院名称 = await extractText(page, PAGE_SELECTORS.documentCourt);
    const 裁判日期 = await extractText(page, PAGE_SELECTORS.documentDate);
    const 案由 = await extractText(page, PAGE_SELECTORS.documentCause);
    const 文书全文 = await extractText(page, PAGE_SELECTORS.documentFullText);

    if (!案件名称 && !案号 && !文书全文) {
        console.error('[ERROR] parseDocumentDetail: 文书内容为空');
        console.error(`[ERROR] parseDocumentDetail: docId = ${docId.substring(0, 50)}...`);

        let pageHint = '';
        try {
            const bodyText = await page.$eval('body', el => el.innerText.substring(0, 200));
            if (bodyText) {
                pageHint = `\n页面内容: ${bodyText.replace(/\s+/g, ' ').trim()}`;
            }
        } catch {
            // 忽略获取页面内容失败
        }

        throw new NotFoundError(
            `文书内容为空，无法获取文书详情。\n`
            + `docId: ${docId.substring(0, 40)}...\n\n`
            + `可能原因：\n`
            + `1. docId 无效或格式错误\n`
            + `2. 该文书已被删除或下架\n`
            + `3. docId 已过期（裁判文书网的 docId 可能会定期更新）\n`
            + `4. 需要更高权限才能访问该文书\n\n`
            + `建议：使用 search_documents 重新搜索获取最新的 docId`
            + pageHint,
        );
    }

    const 当事人 = await parseParties(page);
    const 审判人员 = await parseJudges(page);
    const 法院级别 = inferCourtLevel(法院名称);
    const 案件类型 = inferCaseType(案号, 案件名称);

    return {
        文书ID: docId,
        案件名称: 案件名称 || '未知案件',
        案号: 案号 || '未知案号',
        法院名称: 法院名称 || '未知法院',
        法院级别,
        裁判日期: 裁判日期 || '未知日期',
        案件类型,
        当事人,
        审判人员,
        文书全文: 文书全文 || '',
        案由: 案由 || '未知案由',
    };
}

async function extractText(page: Page, selector: string): Promise<string> {
    try {
        const element = await page.$(selector);
        return (await element?.textContent())?.trim() ?? '';
    } catch {
        return '';
    }
}

async function parseParties(page: Page): Promise<PartyInfo[]> {
    const parties: PartyInfo[] = [];

    try {
        const partyElements = await page.$$(PAGE_SELECTORS.documentParties);
        for (const element of partyElements) {
            const text = await element.textContent();
            if (text) {
                const parsed = parsePartyText(text);
                if (parsed) {
                    parties.push(parsed);
                }
            }
        }
    } catch {
        // 解析失败时返回空数组
    }

    return parties;
}

function parsePartyText(text: string): PartyInfo | null {
    const rolePatterns = [
        /^(原告|被告|上诉人|被上诉人|申请人|被申请人|原审原告|原审被告)[：:]\s*(.+)$/,
        /^(.+?)[（(](原告|被告|上诉人|被上诉人|申请人|被申请人)[）)]$/,
    ];

    for (const pattern of rolePatterns) {
        const match = text.trim().match(pattern);
        if (match && match[1]) {
            const role = match[1].includes('原告') || match[1].includes('申请人') || match[1].includes('上诉人')
                ? match[1]
                : (match[2] ?? match[1]);
            const name = match[2] ?? match[1];
            return {
                角色: role,
                姓名: name,
            };
        }
    }

    if (text.trim()) {
        return {
            角色: '当事人',
            姓名: text.trim(),
        };
    }

    return null;
}

async function parseJudges(page: Page): Promise<string[]> {
    const judges: string[] = [];

    try {
        const judgeElements = await page.$$(PAGE_SELECTORS.documentJudges);
        for (const element of judgeElements) {
            const text = await element.textContent();
            if (text) {
                const names = text.split(/[,，、\s]+/).filter(name => name.trim());
                judges.push(...names);
            }
        }
    } catch {
        // 解析失败时返回空数组
    }

    return judges;
}

function inferCourtLevel(courtName: string): string {
    if (courtName.includes('最高人民法院')) {
        return '最高人民法院';
    }
    if (courtName.includes('高级人民法院')) {
        return '高级人民法院';
    }
    if (courtName.includes('中级人民法院')) {
        return '中级人民法院';
    }
    if (courtName.includes('人民法院')) {
        return '基层人民法院';
    }
    return '未知级别';
}

function inferCaseType(caseNo: string, caseName: string): string {
    const combined = `${caseNo} ${caseName}`;

    if (combined.includes('刑') || combined.includes('刑事')) {
        return '刑事案件';
    }
    if (combined.includes('民') || combined.includes('民事')) {
        return '民事案件';
    }
    if (combined.includes('行') || combined.includes('行政')) {
        return '行政案件';
    }
    if (combined.includes('赔') || combined.includes('赔偿')) {
        return '赔偿案件';
    }
    if (combined.includes('执') || combined.includes('执行')) {
        return '执行案件';
    }

    return '未知类型';
}
