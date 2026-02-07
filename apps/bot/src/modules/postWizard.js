// apps/bot/src/modules/postWizard.js
import ExcelJS from 'exceljs';
import { Markup } from 'telegraf';

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
  return { total, tags: uniq, caption };
}

// ---------- load XLSX ----------
function getColIndex(headerValues, name) {
  return headerValues.findIndex((v) => String(v || '').trim() === name);
}

async function loadCatalogFromXlsx(CATALOG_XLSX_PATH) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(CATALOG_XLSX_PATH);

  // --- items ---
  const wsCat = wb.getWorksheet('Каталог');
  if (!wsCat) throw new Error('В catalog.xlsx отсутствует лист "Каталог".');

  const h = wsCat.getRow(1).values;
  const idxSku = getColIndex(h, 'sku');
  const idxGroup = getColIndex(h, 'group');
  const idxLabel = getColIndex(h, 'label');
  const idxPrice = getColIndex(h, 'price');
  const idxActive = getColIndex(h, 'active');
  const idxTag = getColIndex(h, 'tag_ru');

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

  // --- groups settings ---
  const wsGroups = wb.getWorksheet('Groups') || wb.getWorksheet('groups') || wb.getWorksheet('GROUPS');
  if (!wsGroups) throw new Error('В catalog.xlsx отсутствует лист "Groups" (group/required/mode/allow_none).');

  const hg = wsGroups.getRow(1).values;
  const gGroup = getColIndex(hg, 'group');
  const gReq = getColIndex(hg, 'required');
  const gMode = getColIndex(hg, 'mode');
  const gAllowNone = getColIndex(hg, 'allow_none');

  if ([gGroup, gReq, gMode, gAllowNone].some((i) => i < 1)) {
    throw new Error('Лист "Groups" должен содержать колонки: group, required, mode, allow_none');
  }

  const groups = [];
  wsGroups.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const group = String(row.getCell(gGroup).value || '').trim().toUpperCase();
    if (!group) return;

    const required = Number(row.getCell(gReq).value || 0) === 1;
    const mode = String(row.getCell(gMode).value || '').trim().toLowerCase(); // single|multi
    const allow_none = Number(row.getCell(gAllowNone).value || 0) === 1;

    groups.push({ group, required, mode, allow_none });
  });

  // --- price bands ---
  const wsBands = wb.getWorksheet('PriceBands');
  if (!wsBands) throw new Error('В catalog.xlsx отсутствует лист "PriceBands".');

  const hb = wsBands.getRow(1).values;
  const bMin = getColIndex(hb, 'min');
  const bMax = getColIndex(hb, 'max');
  const bTag = getColIndex(hb, 'tag_ru');

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

  return { items, groups, bands };
}

// ---------- publishing with kb ----------
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
  const { getChannelId, WEBAPP_URL, DEEPLINK_PREFIX, setPostMeta } = deps;

  const chatId = getChannelId();
  if (!chatId) throw new Error('CHANNEL_ID отсутствует или некорректен');

  const me = ctx.botInfo || (await ctx.telegram.getMe());
  const botUsername = me.username;

  const sourceToken = makeSourceToken();
  const kbFull = channelPostKbFull(botUsername, sourceToken, DEEPLINK_PREFIX, WEBAPP_URL).reply_markup;
  const kbFallback = channelPostKbFallback(botUsername, sourceToken, DEEPLINK_PREFIX, WEBAPP_URL).reply_markup;

  const trySend = async ({ useHtml, replyMarkup }) => {
    const common = {
      ...(useHtml ? { parse_mode: 'HTML' } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };

    if (kind === 'text') {
      return await ctx.telegram.sendMessage(chatId, payload.text, {
        ...common,
        disable_web_page_preview: true,
      });
    }
    if (kind === 'photo') {
      return await ctx.telegram.sendPhoto(chatId, payload.fileId, {
        ...common,
        caption: (payload.caption || '').slice(0, 1024),
      });
    }
    if (kind === 'video') {
      return await ctx.telegram.sendVideo(chatId, payload.fileId, {
        ...common,
        caption: (payload.caption || '').slice(0, 1024),
      });
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
  await setPostMeta(sourceToken, {
    text: baseTextNoHint || '',
    absChatId: abs,
    messageId: msg.message_id,
  });

  return { primary: msg, sourceToken };
}

// ---------- module ----------
export function registerPostWizard(bot, deps) {
  const {
    HINT_TEXT,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    CATALOG_XLSX_PATH,
    getChannelId,
    isAdmin,

    setPostMeta, // sourceToken -> meta
    setCatalogPostMeta,
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
  } = deps;

  // guards
  if (typeof setPostMeta !== 'function') throw new Error('registerPostWizard: setPostMeta is required');

  function kbMenu() {
    return Markup.keyboard([['▶️ Новая публикация'], ['♻️ Обновить цены'], ['Отменить']]).resize();
  }
  function kbCancelOnly() {
    return Markup.keyboard([['Отменить']]).resize();
  }

  // 1) старт меню
  bot.command('post', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');
    ctx.session.postWizard = { step: 'menu', draft: null };
    return ctx.reply('Меню /post:', kbMenu());
  });

  // 2) новая публикация: собираем базовый текст/медиа из сообщения /post (как раньше — через reply)
  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'await_source';
    return ctx.reply(
      'Отправьте текст (сообщением) ИЛИ ответьте на фото/видео/документ сообщением с любым текстом.\n\nЗатем я начну мастер выбора комплектации.',
      kbCancelOnly()
    );
  });

  // 3) обновление цен оставляем вашим текущим кодом (если нужно) — тут кратко: меню входа
  bot.hears('♻️ Обновить цены', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'update_prices';
    await ctx.reply(
      'Обновление цен постов:\n\n1) «🧾 По пересланному посту» — перешлите пост из канала.\n2) «🔁 Обновить все» — обновлю все, для которых есть мета.',
      Markup.keyboard([['🧾 По пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  bot.hears('⬅️ Назад', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard) return;
    ctx.session.postWizard.step = 'menu';
    return ctx.reply('Меню /post:', kbMenu());
  });

  bot.hears('Отменить', async (ctx) => {
    if (ctx.session?.postWizard) ctx.session.postWizard = null;
    return ctx.reply('Отменено.', Markup.removeKeyboard());
  });

  // 4) основной message handler мастера
  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();
    if (!isAdmin(ctx)) return; // пост-мастер только админам

    // ---- шаг: ожидание исходника (текст или reply на медиа) ----
    if (wiz.step === 'await_source') {
      const rawText = 'text' in ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
      const r = ctx.message?.reply_to_message;

      let baseTextNoHint = rawText.replace(/^\/post(@\S+)?\s*/i, '').trim();
      let mediaPayload = { kind: 'text' };

      if (r?.photo?.length) {
        mediaPayload = { kind: 'photo', fileId: r.photo.at(-1).file_id };
      } else if (r?.video) {
        mediaPayload = { kind: 'video', fileId: r.video.file_id };
      } else if (r?.document) {
        mediaPayload = { kind: 'document', fileId: r.document.file_id };
      } else {
        mediaPayload = { kind: 'text' };
      }

      // если это не reply на медиа и нет текста — просим снова
      if (mediaPayload.kind === 'text' && !baseTextNoHint) {
        await ctx.reply('Пришлите текст поста (сообщением), либо ответьте на медиа сообщением.', kbCancelOnly());
        return;
      }

      // загружаем каталог и группы
      const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

      // init selected по группам (single=null, multi=[])
      const selected = {};
      for (const g of catalog.groups) {
        selected[g.group] = g.mode === 'multi' ? [] : null;
      }

      wiz.draft = {
        baseTextNoHint,
        mediaPayload,
        selected,
        groupIndex: 0,
      };

      wiz.step = 'pick';
      return askCurrentGroup(ctx, catalog, wiz);
    }

    // ---- шаг: выбор значений по группам ----
    if (wiz.step === 'pick') {
      const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const g = currentGroup(catalog, wiz);
      if (!g) {
        wiz.step = 'preview';
        return showPreview(ctx, catalog, wiz, HINT_TEXT);
      }

      // отмена
      if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
        ctx.session.postWizard = null;
        await ctx.reply('Отменено.', Markup.removeKeyboard());
        return;
      }

      if (!('text' in ctx.message) || !ctx.message.text) return;
      const text = ctx.message.text.trim();

      // multi controls
      if (g.mode === 'multi') {
        if (text === 'Далее') {
          wiz.draft.groupIndex += 1;
          return askCurrentGroup(ctx, catalog, wiz);
        }
        if (text === 'Сбросить') {
          wiz.draft.selected[g.group] = [];
          return askCurrentGroup(ctx, catalog, wiz);
        }
      }

      // allow_none
      if (g.allow_none && text === '— Нет —') {
        wiz.draft.selected[g.group] = g.mode === 'multi' ? [] : null;
        wiz.draft.groupIndex += 1;
        return askCurrentGroup(ctx, catalog, wiz);
      }

      // выбор item по label
      const list = catalog.items.filter((it) => it.group === g.group);
      const it = list.find((x) => x.label === text);
      if (!it) {
        await ctx.reply('Не понял выбор. Нажмите кнопку на клавиатуре.', buildKeyboardForGroup(g, list));
        return;
      }

      if (g.mode === 'single') {
        wiz.draft.selected[g.group] = it.sku;
        wiz.draft.groupIndex += 1;
        return askCurrentGroup(ctx, catalog, wiz);
      } else {
        const arr = Array.isArray(wiz.draft.selected[g.group]) ? wiz.draft.selected[g.group] : [];
        const idx = arr.indexOf(it.sku);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(it.sku);
        wiz.draft.selected[g.group] = arr;
        // остаёмся на той же группе, чтобы можно было выбрать несколько
        return;
      }
    }

    // ---- шаг: предпросмотр ----
    if (wiz.step === 'preview') {
      if (!('text' in ctx.message) || !ctx.message.text) return;
      const text = ctx.message.text.trim();

      if (text === 'Опубликовать') {
        const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
        const { caption, total } = calcCaptionAndTags(catalog, wiz.draft.selected);

        const base = (wiz.draft.baseTextNoHint || '').trim();
        const finalText = base ? `${base}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

        const payload = wiz.draft.mediaPayload;
        const kind = payload.kind;

        let primary;
        if (kind === 'photo') {
          ({ primary } = await postToChannelWithKb(ctx, deps, 'photo', { fileId: payload.fileId, caption: finalText }, base));
        } else if (kind === 'video') {
          ({ primary } = await postToChannelWithKb(ctx, deps, 'video', { fileId: payload.fileId, caption: finalText }, base));
        } else if (kind === 'document') {
          ({ primary } = await postToChannelWithKb(ctx, deps, 'document', { fileId: payload.fileId, caption: finalText }, base));
        } else {
          ({ primary } = await postToChannelWithKb(ctx, deps, 'text', { text: finalText }, base));
        }

        // мета для обновления цен
        await setCatalogPostMeta(primary.message_id, {
          selected: wiz.draft.selected,
          baseTextNoHint: base,
          last_total_price: total,
          createdAt: Date.now(),
          status: 'ok',
        });

        ctx.session.postWizard = null;
        await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
        return;
      }

      if (text === '⬅️ Назад') {
        wiz.step = 'pick';
        wiz.draft.groupIndex = Math.max(0, wiz.draft.groupIndex - 1);
        const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
        return askCurrentGroup(ctx, catalog, wiz);
      }
    }

    // ---- update prices (оставлено совместимо с вашими функциями) ----
    if (wiz.step === 'update_prices') {
      // Здесь можно оставить вашу текущую реализацию обновления (у вас уже есть в другом варианте).
      await ctx.reply('Обновление цен сейчас не подключено в этом файле. Если нужно — скажите, добавлю.', kbMenu());
      wiz.step = 'menu';
      return;
    }

    return next();
  });

  // ----- helpers -----
  function currentGroup(catalog, wiz) {
    const idx = Number(wiz?.draft?.groupIndex || 0);
    return catalog.groups[idx] || null;
  }

  function buildKeyboardForGroup(g, list) {
    const buttons = list.map((it) => it.label);
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    if (g.allow_none) rows.push(['— Нет —']);

    if (g.mode === 'multi') rows.unshift(['Далее', 'Сбросить']);

    rows.push(['Отменить']);
    return Markup.keyboard(rows).resize();
  }

  async function askCurrentGroup(ctx, catalog, wiz) {
    const g = currentGroup(catalog, wiz);
    if (!g) {
      wiz.step = 'preview';
      return showPreview(ctx, catalog, wiz, HINT_TEXT);
    }

    const list = catalog.items.filter((it) => it.group === g.group);
    if (!list.length) {
      // если в каталоге нет элементов для группы — просто пропускаем
      wiz.draft.groupIndex += 1;
      return askCurrentGroup(ctx, catalog, wiz);
    }

    const title = `${g.group}: ${g.mode === 'multi' ? 'можно несколько' : 'выберите один'}${
      g.allow_none ? ' (можно — Нет —)' : ''
    }`;

    return ctx.reply(title, buildKeyboardForGroup(g, list));
  }

  async function showPreview(ctx, catalog, wiz, hintText) {
    const { caption } = calcCaptionAndTags(catalog, wiz.draft.selected);

    const base = (wiz.draft.baseTextNoHint || '').trim();
    const full = base ? `${base}\n\n${caption}\n\n${hintText}` : `${caption}\n\n${hintText}`;

    wiz.step = 'preview';
    await ctx.reply(
      `Предпросмотр:\n\n${full}\n\nНажмите «Опубликовать» или «⬅️ Назад».`,
      Markup.keyboard([['Опубликовать'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  }
}
