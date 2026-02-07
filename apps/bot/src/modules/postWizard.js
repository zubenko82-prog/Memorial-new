// apps/bot/src/modules/postWizard.js
import ExcelJS from 'exceljs';
import { Markup } from 'telegraf';

function makeSourceTokenForPost(absChatId, messageId) {
  return `p_${absChatId}_${messageId}_${Math.random().toString(16).slice(2)}`;
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
  return { total, tags: uniq, caption };
}

// --- helpers ---
const normStr = (v) => String(v || '').trim();
const up = (v) => normStr(v).toUpperCase();

function isOptionItem(it) {
  const g = up(it.group);
  const sku = up(it.sku);
  return g === 'OPTION' || sku.startsWith('OPT_');
}

function isGrafikaItem(it) {
  const g = up(it.group);
  const sku = up(it.sku);
  return g === 'GRAFIKA' || sku.startsWith('GRAF_');
}

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

    const sku = normStr(row.getCell(idxSku).value);
    if (!sku) return;

    const active = row.getCell(idxActive).value;
    const isActive = String(active).trim() === '1' || active === 1 || active === true;
    if (!isActive) return;

    const group = normStr(row.getCell(idxGroup).value).toUpperCase();
    const label = normStr(row.getCell(idxLabel).value) || sku;
    const price = Number(row.getCell(idxPrice).value || 0);
    const tag_ru = normStr(row.getCell(idxTag)?.value);

    items.push({ sku, group, label, price, tag_ru });
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
    const tag = normStr(row.getCell(bTag).value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !tag) return;
    bands.push({ min, max, tag });
  });

  return { items, bands };
}

export function registerPostWizard(bot, deps) {
  const {
    HINT_TEXT,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    CATALOG_XLSX_PATH,
    getChannelId,
    isAdmin,
    setPostMeta,
    CHANNEL_USERNAME,
    setCatalogPostMeta,
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
  } = deps;

  const stepsOrder = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'OPTION', 'GRAFIKA', 'PREVIEW'];

  function channelPostKbFull(botUsername, sourceToken) {
    const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
    const webAppUrl = new URL(WEBAPP_URL).toString();
    return Markup.inlineKeyboard([
      [
        Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`),
        Markup.button.webApp('Подобрать памятник', webAppUrl),
      ],
    ]);
  }

  function channelPostKbFallback(botUsername, sourceToken) {
    const startParam = `${DEEPLINK_PREFIX}_${sourceToken}`;
    const webAppUrl = new URL(WEBAPP_URL).toString();
    return Markup.inlineKeyboard([
      [Markup.button.url('Заказать', `https://t.me/${botUsername}?start=${startParam}`)],
      [Markup.button.url('Подобрать памятник', webAppUrl)],
    ]);
  }

  async function postToChannelWithKb(ctx, kind, payload, baseTextNoHint) {
    const chatId = getChannelId();
    if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');
    const me = ctx.botInfo || (await ctx.telegram.getMe());
    const botUsername = me.username;

    const isHtmlIssue = (desc) => /parse entities|can't parse entities|entity|wrong entity/i.test(desc);
    const isWebAppIssue = (desc) =>
      /BUTTON_TYPE_INVALID/i.test(desc) || /web_app/i.test(desc) || /domain/i.test(desc) || /not allowed/i.test(desc);

    const trySendNoKb = async ({ useHtml }) => {
      const common = { ...(useHtml ? { parse_mode: 'HTML' } : {}) };

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

    let msg;
    try {
      msg = await trySendNoKb({ useHtml: true });
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      if (isHtmlIssue(desc)) msg = await trySendNoKb({ useHtml: false });
      else throw e;
    }

    const absChatId = Math.abs(Number(msg.chat.id));
    const sourceToken = makeSourceTokenForPost(absChatId, msg.message_id);

    const kbFull2 = channelPostKbFull(botUsername, sourceToken).reply_markup;
    const kbFallback2 = channelPostKbFallback(botUsername, sourceToken).reply_markup;

    try {
      await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFull2);
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      if (isWebAppIssue(desc)) {
        await ctx.telegram.editMessageReplyMarkup(chatId, msg.message_id, undefined, kbFallback2);
      } else {
        console.warn('[bot] cannot set reply_markup:', desc);
      }
    }

    await setPostMeta(sourceToken, {
      text: (baseTextNoHint || '').trim(),
      channelUsername: CHANNEL_USERNAME,
      messageId: msg.message_id,
      absChatId,
    });

    return { primary: msg, sourceToken };
  }

  const kbPostMenu = () =>
    Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();
  const kbPostCancelOnly = () => Markup.keyboard([['Отменить']]).resize();

  // /post старт
  bot.command('post', async (ctx) => {
    const channelId = getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
    if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');
    if (ctx.session?.order) {
      return ctx.reply('Сейчас активна анкета. Завершите/отмените /cancel, затем используйте /post.');
    }

    const raw = ctx.message?.text || '';
    const baseTextNoHint = raw.replace(/^\/post(@\S+)?\s*/i, '').trim();

    const r = ctx.message?.reply_to_message;
    const mediaPayload = {};
    if (r?.photo?.length) {
      mediaPayload.kind = 'photo';
      mediaPayload.fileId = r.photo.at(-1).file_id;
    } else if (r?.video) {
      mediaPayload.kind = 'video';
      mediaPayload.fileId = r.video.file_id;
    } else if (r?.document) {
      mediaPayload.kind = 'document';
      mediaPayload.fileId = r.document.file_id;
    } else {
      mediaPayload.kind = 'text';
    }

    ctx.session.postWizard = {
      step: 'menu',
      baseTextNoHint,
      mediaPayload,
      selected: {
        STELA: null,
        TUMBA: null,
        CVETNIK: null,
        PLITA: null,
        WORK: null,
        OPTION: [],
        GRAFIKA: [],
      },
    };

    return ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('▶️ Новая публикация', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();

    ctx.session.postWizard.step = 'STELA';
    console.log('[postWizard] start wizard, step STELA');
    return askStep(ctx, 'STELA');
  });

  bot.hears('♻️ Обновить цены', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return next();

    ctx.session.postWizard.step = 'update_prices';
    await ctx.reply(
      'Обновление цен постов:\n\n1) Нажмите «🧾 Обновить по пересланному посту» и перешлите сюда пост из канала.\n\n2) Или нажмите «🔁 Обновить все».',
      Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (ctx.session?.order) return next();
    if (!isAdmin(ctx)) return next();
    if (!ctx.session?.postWizard) return next();

    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('Отменить', async (ctx, next) => {
    if (!ctx.session?.postWizard) return next();
    ctx.session.postWizard = null;
    await ctx.reply('Отменено.', Markup.removeKeyboard());
  });

  async function askStep(ctx, step) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    let list = [];
    if (step === 'OPTION') list = items.filter(isOptionItem);
    else if (step === 'GRAFIKA') list = items.filter(isGrafikaItem);
    else list = items.filter((it) => it.group === step);

    if (!list.length) return advance(ctx);

    const buttons = list.map((it) => it.label || it.sku);
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    const optionalSingles = ['CVETNIK', 'PLITA', 'WORK'];
    if (optionalSingles.includes(step)) rows.push(['— Нет —']);

    rows.push(['Отменить']);

    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Работа (или — Нет —):',
      OPTION: 'Опции (можно несколько). Нажмите «Далее» когда закончите:',
      GRAFIKA: 'Графика (можно несколько). Нажмите «Далее» когда закончите:',
    };

    if (step === 'OPTION' || step === 'GRAFIKA') rows.unshift(['Далее', 'Сбросить']);

    console.log('[postWizard] askStep', step, 'buttons=', buttons);
    await ctx.reply(titleMap[step] || `Выберите ${step}:`, Markup.keyboard(rows).resize());
  }

  async function advance(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const idx = stepsOrder.indexOf(wiz.step);
    wiz.step = stepsOrder[idx + 1] || 'PREVIEW';
    console.log('[postWizard] advance to', wiz.step);

    if (wiz.step === 'PREVIEW') return preview(ctx);
    return askStep(ctx, wiz.step);
  }

  async function preview(ctx) {
    const wiz = ctx.session.postWizard;
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = normStr(wiz.baseTextNoHint);
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    wiz.step = 'CONFIRM';
    wiz._previewTotal = total;

    await ctx.reply(
      `Предпросмотр:\n\n${fullCaption}\n\nЕсли всё верно — нажмите «Опубликовать».`,
      Markup.keyboard([['Опубликовать'], ['Отменить']]).resize()
    );
  }

  bot.on('message', async (ctx, next) => {
    console.log('[postWizard] on message, step =', ctx.session?.postWizard?.step);
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    if (!('text' in ctx.message) || !ctx.message.text) return next();
    const text = ctx.message.text.trim();

    if (wiz.step === 'CONFIRM') {
      if (text !== 'Опубликовать') return next();

      const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

      const baseText = normStr(wiz.baseTextNoHint);
      const finalCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(
        0,
        1024
      );

      const payload = wiz.mediaPayload || { kind: 'text' };
      const kind = payload.kind;

      let primary;
      if (kind === 'photo') {
        ({ primary } = await postToChannelWithKb(ctx, 'photo', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else if (kind === 'video') {
        ({ primary } = await postToChannelWithKb(ctx, 'video', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else if (kind === 'document') {
        ({ primary } = await postToChannelWithKb(ctx, 'document', { fileId: payload.fileId, caption: finalCaption }, baseText));
      } else {
        ({ primary } = await postToChannelWithKb(ctx, 'text', { text: finalCaption }, baseText));
      }

      await setCatalogPostMeta(primary.message_id, {
        selected: wiz.selected,
        baseTextNoHint: baseText,
        last_total_price: total,
        createdAt: Date.now(),
      });

      ctx.session.postWizard = null;
      await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
      return;
    }

    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      console.log('[postWizard] OPTION/GRAFIKA step=', wiz.step, 'text=', JSON.stringify(text));

      if (text === 'Далее') return advance(ctx);
      if (text === 'Сбросить') {
        wiz.selected[wiz.step] = [];
        return askStep(ctx, wiz.step);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const pool = wiz.step === 'OPTION' ? items.filter(isOptionItem) : items.filter(isGrafikaItem);

      const it =
        pool.find((x) => normStr(x.label) === text) ||
        pool.find((x) => normStr(x.sku) === text) ||
        pool.find((x) => up(x.sku) === up(text));

      if (!it) {
        console.log('[postWizard] item not found for text', text);
        return;
      }

      const arr = Array.isArray(wiz.selected[wiz.step]) ? wiz.selected[wiz.step] : [];
      const idx = arr.indexOf(it.sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(it.sku);
      wiz.selected[wiz.step] = arr;

      console.log('[postWizard] selected', wiz.step, wiz.selected[wiz.step]);
      return;
    }

    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      console.log('[postWizard] single step', wiz.step, 'text=', JSON.stringify(text));

      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;
        return advance(ctx);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const it = items.find((x) => x.group === wiz.step && normStr(x.label) === text);
      if (!it) {
        console.log('[postWizard] single item not found for', wiz.step, text);
        return;
      }

      wiz.selected[wiz.step] = it.sku;
      console.log('[postWizard] chosen', wiz.step, it.sku);
      return advance(ctx);
    }

    return next();
  });
}
