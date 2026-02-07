// apps/bot/src/modules/postWizard.js
import ExcelJS from 'exceljs';
import { Markup } from 'telegraf';

// ---------- helpers ----------
function makeSourceToken() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatRub(n) {
  const s = Math.round(Number(n) || 0).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function normalizeSelectedToSkuList(selected) {
  const res = [];
  for (const v of Object.values(selected || {})) {
    if (!v) continue;
    if (Array.isArray(v)) res.push(...v);
    else res.push(v);
  }
  const seen = new Set();
  const out = [];
  for (const sku of res) {
    if (!seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

function pickBandTag(bands, total) {
  for (const b of bands) {
    if (total >= b.min && total <= b.max) return b.tag;
  }
  return '';
}

function calcCaptionAndTags({ items, bands }, selected) {
  const skuList = normalizeSelectedToSkuList(selected);
  const bySku = new Map(items.map((it) => [it.sku, it]));
  let total = 0;

  let stelaTag = '';
  let plitaTag = '';
  let workTag = '';
  let hasPlita = false;
  let hasCvetnik = false;

  for (const sku of skuList) {
    const it = bySku.get(sku);
    if (!it) continue;

    total += Number(it.price || 0);

    if (it.group === 'STELA' && it.tag_ru) stelaTag = it.tag_ru;
    if (it.group === 'PLITA') {
      hasPlita = true;
      if (it.tag_ru) plitaTag = it.tag_ru;
    }
    if (it.group === 'CVETNIK') hasCvetnik = true;
    if (it.group === 'WORK' && it.tag_ru) workTag = it.tag_ru;
  }

  const tags = [];
  if (stelaTag) tags.push(stelaTag);
  if (hasPlita) {
    if (plitaTag) tags.push(plitaTag);
  } else {
    tags.push('#без_плиты');
  }
  if (!hasCvetnik) tags.push('#без_цветника');
  if (workTag) tags.push(workTag);

  const bandTag = pickBandTag(bands, total);
  if (bandTag) tags.push(bandTag);

  const uniq = [];
  const seen = new Set();
  for (const t of tags) {
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      uniq.push(t);
    }
  }

  const caption = `Цена: ${formatRub(total)} ₽\n${uniq.join(' ')}`.trim();
  return { total, caption, tags: uniq };
}

// ---------- load XLSX ----------
async function loadCatalogFromXlsx(CATALOG_XLSX_PATH) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CATALOG_XLSX_PATH);

  const wsCat = wb.getWorksheet('Каталог');
  if (!wsCat) throw new Error('В catalog.xlsx отсутствует лист "Каталог".');

  const header = wsCat.getRow(1).values;
  const colIndex = (name) => header.findIndex((v) => String(v || '').trim() === name);

  const idxSku = colIndex('sku');
  const idxGroup = colIndex('group');
  const idxLabel = colIndex('label');
  const idxPrice = colIndex('price');
  const idxActive = colIndex('active');
  const idxTag = colIndex('tag_ru');

  if ([idxSku, idxGroup, idxLabel, idxPrice, idxActive].some((i) => i < 1)) {
    throw new Error('Лист "Каталог" должен содержать колонки: sku, group, label, price, active, tag_ru');
  }

  const items = [];
  wsCat.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const sku = String(row.getCell(idxSku).value || '').trim();
    if (!sku) return;

    const active = row.getCell(idxActive).value;
    const isActive = String(active).trim() === '1' || active === 1 || active === true;
    if (!isActive) return;

    items.push({
      sku,
      group: String(row.getCell(idxGroup).value || '').trim().toUpperCase(),
      label: String(row.getCell(idxLabel).value || '').trim(),
      price: Number(row.getCell(idxPrice).value || 0),
      tag_ru: String(row.getCell(idxTag)?.value || '').trim(),
    });
  });

  const wsBands = wb.getWorksheet('PriceBands');
  if (!wsBands) throw new Error('В catalog.xlsx отсутствует лист "PriceBands".');

  const headerB = wsBands.getRow(1).values;
  const bMin = headerB.findIndex((v) => String(v || '').trim() === 'min');
  const bMax = headerB.findIndex((v) => String(v || '').trim() === 'max');
  const bTag = headerB.findIndex((v) => String(v || '').trim() === 'tag_ru');

  if ([bMin, bMax, bTag].some((i) => i < 1)) {
    throw new Error('Лист "PriceBands" должен содержать колонки: min, max, tag_ru');
  }

  const bands = [];
  wsBands.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const min = Number(row.getCell(bMin).value);
    const max = Number(row.getCell(bMax).value);
    const tag = String(row.getCell(bTag).value || '').trim();
    if (!Number.isFinite(min) || !Number.isFinite(max) || !tag) return;
    bands.push({ min, max, tag });
  });

  return { items, bands };
}

// ---------- publish to channel with kb ----------
function channelPostKbFull(botUsername, sourceToken, DEEPLINK_PREFIX, WEBAPP_URL) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [
      Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
      Markup.button.webApp('Подобрать памятник', webAppUrl),
    ],
  ]);
}

function channelPostKbFallback(botUsername, sourceToken, DEEPLINK_PREFIX, WEBAPP_URL) {
  const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
  const webAppUrl = new URL(WEBAPP_URL).toString();
  return Markup.inlineKeyboard([
    [Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)],
    [Markup.button.url('Подобрать памятник', webAppUrl)],
  ]);
}

async function postToChannelWithKb(ctx, deps, kind, payload, baseTextNoHint) {
  const chatId = deps.getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');

  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const botUsername = me.username;

  const sourceToken = makeSourceToken();
  const kbFull = channelPostKbFull(botUsername, sourceToken, deps.DEEPLINK_PREFIX, deps.WEBAPP_URL).reply_markup;
  const kbFallback = channelPostKbFallback(botUsername, sourceToken, deps.DEEPLINK_PREFIX, deps.WEBAPP_URL).reply_markup;

  const trySend = async ({ useHtml, replyMarkup }) => {
    const common = { ...(useHtml ? { parse_mode: 'HTML' } : {}), ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };

    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, { ...common, disable_web_page_preview: true });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, { ...common, caption: (payload.caption || '').slice(0, 1024) });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, { ...common, caption: (payload.caption || '').slice(0, 1024) });
    }
    if (kind === 'document') {
      const canCaption = (payload.caption || '').length <= 1024 ? payload.caption : undefined;
      return await ctx.telegram.sendDocument(chatId, payload.fileId, { ...common, caption: canCaption });
    }
    throw new Error('Unknown kind');
  };

  const isHtmlIssue = (desc) => /parse entities|can't parse entities|entity|wrong entity/i.test(desc);
  const isWebAppIssue = (desc) =>
    /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

  let msg = null;
  try {
    msg = await trySend({ useHtml: true, replyMarkup: kbFull });
  } catch (e) {
    const desc = e?.response?.description || e?.message || String(e);

    if (isHtmlIssue(desc)) {
      try {
        msg = await trySend({ useHtml: false, replyMarkup: kbFull });
      } catch (e2) {
        const desc2 = e2?.response?.description || e2?.message || String(e2);
        if (isWebAppIssue(desc2)) msg = await trySend({ useHtml: false, replyMarkup: kbFallback });
        else throw e2;
      }
    } else if (isWebAppIssue(desc)) {
      try {
        msg = await trySend({ useHtml: true, replyMarkup: kbFallback });
      } catch (e3) {
        const desc3 = e3?.response?.description || e3?.message || String(e3);
        if (isHtmlIssue(desc3)) msg = await trySend({ useHtml: false, replyMarkup: kbFallback });
        else throw e3;
      }
    } else {
      throw e;
    }
  }

  const abs = Math.abs(Number(msg.chat.id));
  await deps.setPostMeta(sourceToken, { text: baseTextNoHint || '', absChatId: abs, messageId: msg.message_id });

  return { primary: msg, sourceToken };
}

// ---------- module ----------
export function registerPostWizard(bot, deps) {
  if (typeof deps.setPostMeta !== 'function') {
    throw new Error('registerPostWizard: setPostMeta is required');
  }

  const STEPS = [
    { group: 'STELA', mode: 'single', allowNone: false },
    { group: 'TUMBA', mode: 'single', allowNone: false },
    { group: 'CVETNIK', mode: 'single', allowNone: true },
    { group: 'PLITA', mode: 'single', allowNone: true },
    { group: 'WORK', mode: 'single', allowNone: true },
    { group: 'OPTION', mode: 'multi', allowNone: false },
    { group: 'GRAFIKA', mode: 'multi', allowNone: false },
  ];

  const kbMenu = () => Markup.keyboard([['▶️ Новая публикация'], ['Отменить']]).resize();
  const kbCancelOnly = () => Markup.keyboard([['Отменить']]).resize();

  const initSelected = () => {
    const selected = {};
    for (const s of STEPS) selected[s.group] = s.mode === 'multi' ? [] : null;
    return selected;
  };

  const kbForStep = (step, list) => {
    const buttons = list.map((it) => it.label);
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    if (step.allowNone) rows.push(['— Нет —']);
    if (step.mode === 'multi') rows.unshift(['Далее', 'Сбросить']);
    rows.push(['Отменить']);
    return Markup.keyboard(rows).resize();
  };

  async function askStep(ctx) {
    const wiz = ctx.session.postWizard;
    const catalog = await loadCatalogFromXlsx(deps.CATALOG_XLSX_PATH);

    const step = STEPS[wiz.stepIndex];
    if (!step) {
      wiz.step = 'preview';
      return preview(ctx, catalog);
    }

    const list = catalog.items.filter((it) => it.group === step.group);
    if (!list.length) {
      wiz.stepIndex += 1;
      return askStep(ctx);
    }

    const title =
      step.mode === 'multi'
        ? `${step.group}: можно несколько (нажимайте кнопки, потом «Далее»)`
        : `${step.group}: выберите один вариант`;

    return ctx.reply(title, kbForStep(step, list));
  }

  async function preview(ctx, catalog) {
    const wiz = ctx.session.postWizard;

    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);
    wiz._previewTotal = total;

    const base = (wiz.baseTextNoHint || '').trim();
    const full = base ? `${base}\n\n${caption}\n\n${deps.HINT_TEXT}` : `${caption}\n\n${deps.HINT_TEXT}`;

    return ctx.reply(
      `Предпросмотр:\n\n${full}\n\nНажмите «Опубликовать» или «Назад».`,
      Markup.keyboard([['Опубликовать'], ['Назад'], ['Отменить']]).resize()
    );
  }

  bot.command('post', async (ctx) => {
    const channelId = deps.getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
    if (!deps.isAdmin(ctx)) return ctx.reply('Недостаточно прав.');

    ctx.session.postWizard = { step: 'menu' };
    return ctx.reply('Меню /post:', kbMenu());
  });

  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!deps.isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'await_base';
    return ctx.reply(
      'Пришлите текст поста (сообщением) ИЛИ ответьте на фото/видео/документ сообщением (текстом можно пусто).',
      kbCancelOnly()
    );
  });

  bot.hears('Отменить', async (ctx) => {
    if (!ctx.session?.postWizard) return;
    ctx.session.postWizard = null;
    return ctx.reply('Отменено.', Markup.removeKeyboard());
  });

  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();
    if (!deps.isAdmin(ctx)) return;

    // 1) ждём исходник
    if (wiz.step === 'await_base') {
      const text = 'text' in ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
      const r = ctx.message?.reply_to_message;

      wiz.baseTextNoHint = text;

      if (r?.photo?.length) wiz.media = { kind: 'photo', fileId: r.photo.at(-1).file_id };
      else if (r?.video) wiz.media = { kind: 'video', fileId: r.video.file_id };
      else if (r?.document) wiz.media = { kind: 'document', fileId: r.document.file_id };
      else wiz.media = { kind: 'text' };

      if (wiz.media.kind === 'text' && !wiz.baseTextNoHint) {
        return ctx.reply('Нужен текст поста, либо ответьте на медиа сообщением.', kbCancelOnly());
      }

      wiz.selected = initSelected();
      wiz.stepIndex = 0;
      wiz.step = 'pick';
      return askStep(ctx);
    }

    // 2) выбор
    if (wiz.step === 'pick') {
      if (!('text' in ctx.message) || !ctx.message.text) return;
      const input = ctx.message.text.trim();

      const catalog = await loadCatalogFromXlsx(deps.CATALOG_XLSX_PATH);
      const step = STEPS[wiz.stepIndex];

      if (!step) {
        wiz.step = 'preview';
        return preview(ctx, catalog);
      }

      if (input === 'Отменить') {
        ctx.session.postWizard = null;
        return ctx.reply('Отменено.', Markup.removeKeyboard());
      }

      if (step.mode === 'multi') {
        if (input === 'Далее') {
          wiz.stepIndex += 1;
          return askStep(ctx);
        }
        if (input === 'Сбросить') {
          wiz.selected[step.group] = [];
          return askStep(ctx);
        }
      }

      if (step.allowNone && input === '— Нет —') {
        wiz.selected[step.group] = step.mode === 'multi' ? [] : null;
        wiz.stepIndex += 1;
        return askStep(ctx);
      }

      const list = catalog.items.filter((it) => it.group === step.group);
      const it = list.find((x) => x.label === input);
      if (!it) return ctx.reply('Нажмите кнопку на клавиатуре.', kbForStep(step, list));

      if (step.mode === 'single') {
        wiz.selected[step.group] = it.sku;
        wiz.stepIndex += 1;
        return askStep(ctx);
      } else {
        const arr = Array.isArray(wiz.selected[step.group]) ? wiz.selected[step.group] : [];
        const idx = arr.indexOf(it.sku);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(it.sku);
        wiz.selected[step.group] = arr;
        return;
      }
    }

    // 3) предпросмотр
    if (wiz.step === 'preview') {
      if (!('text' in ctx.message) || !ctx.message.text) return;
      const input = ctx.message.text.trim();

      if (input === 'Назад') {
        wiz.step = 'pick';
        wiz.stepIndex = Math.max(0, (wiz.stepIndex || 0) - 1);
        return askStep(ctx);
      }

      if (input !== 'Опубликовать') return;

      const catalog = await loadCatalogFromXlsx(deps.CATALOG_XLSX_PATH);
      const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

      const base = (wiz.baseTextNoHint || '').trim();
      const final = base ? `${base}\n\n${caption}\n\n${deps.HINT_TEXT}` : `${caption}\n\n${deps.HINT_TEXT}`;

      const kind = wiz.media.kind;

      let primary;
      if (kind === 'photo') {
        ({ primary } = await postToChannelWithKb(ctx, deps, 'photo', { fileId: wiz.media.fileId, caption: final }, base));
      } else if (kind === 'video') {
        ({ primary } = await postToChannelWithKb(ctx, deps, 'video', { fileId: wiz.media.fileId, caption: final }, base));
      } else if (kind === 'document') {
        ({ primary } = await postToChannelWithKb(ctx, deps, 'document', { fileId: wiz.media.fileId, caption: final }, base));
      } else {
        ({ primary } = await postToChannelWithKb(ctx, deps, 'text', { text: final }, base));
      }

      if (typeof deps.setCatalogPostMeta === 'function') {
        await deps.setCatalogPostMeta(primary.message_id, {
          channel_id: String(deps.getChannelId()),
          message_id_caption: primary.message_id,
          date: Date.now(),
          items: wiz.selected,
          last_total_price: total,
          status: 'ok',
        });
      }

      ctx.session.postWizard = null;
      return ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
    }

    return next();
  });
}
