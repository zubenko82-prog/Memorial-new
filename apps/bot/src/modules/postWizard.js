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

export function registerPostWizard(bot, deps) {
  const {
    HINT_TEXT,
    WEBAPP_URL,
    DEEPLINK_PREFIX,
    CATALOG_XLSX_PATH,
    getChannelId,
    isAdmin,
    // storage for update prices:
    setCatalogPostMeta,
    getCatalogPostMeta,
    getAllCatalogPostKeys,
    getCatalogPostMetaByKey,
    setCatalogPostMetaByKey,
  } = deps;

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
      const common = {
        ...(useHtml ? { parse_mode: 'HTML' } : {}),
      };

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

    return { primary: msg, sourceToken };
  }

  function kbPostMenu() {
    return Markup.keyboard([['♻️ Обновить цены'], ['▶️ Новая публикация'], ['Отменить']]).resize();
  }
  function kbPostCancelOnly() {
    return Markup.keyboard([['Отменить']]).resize();
  }

  bot.command('post', async (ctx) => {
    try {
      const channelId = getChannelId();
      if (!channelId) return ctx.reply('CHANNEL_ID не задан или некорректен.');
      if (!isAdmin(ctx)) return ctx.reply('Недостаточно прав.');
      if (ctx.session?.order) {
        return ctx.reply('Сейчас активна анкета. Завершите или отмените её командой /cancel, затем используйте /post.');
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

      await ctx.reply('Меню /post:', kbPostMenu());
    } catch (e) {
      console.error('[bot]/post wizard menu error:', e);
      const desc = e?.response?.description || e?.message || 'Неизвестная ошибка';
      return ctx.reply(`Ошибка /post: ${desc}`);
    }
  });

  // -------- update prices menu --------
  bot.hears('♻️ Обновить цены', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'update_prices';
    await ctx.reply(
      'Обновление цен постов:\n\n1) Нажмите «🧾 Обновить по пересланному посту» и перешлите сюда пост из канала.\n\n2) Или нажмите «🔁 Обновить все» (если мета постов хранится и доступна).',
      Markup.keyboard([['🧾 Обновить по пересланному посту'], ['🔁 Обновить все'], ['⬅️ Назад'], ['Отменить']]).resize()
    );
  });

  bot.hears('🧾 Обновить по пересланному посту', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    ctx.session.postWizard.step = 'update_wait_forward';
    await ctx.reply(
      'Перешлите сюда пост из канала — я пересчитаю цену и обновлю подпись.\n\nВажно: пост должен быть опубликован через мастер /post (чтобы у бота был состав).',
      kbPostCancelOnly()
    );
  });

  bot.hears('🔁 Обновить все', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'update_prices') return;

    const channelId = getChannelId();
    if (!channelId) return ctx.reply('CHANNEL_ID не задан.');

    const keys = await getAllCatalogPostKeys();
    if (!keys.length) {
      await ctx.reply(
        'Нет сохранённых данных о постах для обновления.\n\nВажно: массовое обновление работает только для постов, опубликованных через мастер /post.',
        kbPostMenu()
      );
      ctx.session.postWizard.step = 'menu';
      return;
    }

    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const key of keys) {
      try {
        const meta = await getCatalogPostMetaByKey(key);
        if (!meta?.selected) {
          skipped++;
          continue;
        }

        const messageId = Number(String(key).split(':').at(-1));
        if (!messageId) {
          skipped++;
          continue;
        }

        const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
        const baseText = (meta.baseTextNoHint || '').trim();
        const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

        if (Number(meta.last_total_price) === Number(total)) {
          skipped++;
          continue;
        }

        await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);
        await setCatalogPostMetaByKey(key, { ...meta, last_total_price: total, updatedAt: Date.now() });

        updated++;
      } catch {
        errors++;
      }
    }

    await ctx.reply(`Готово.\nОбновлено: ${updated}\nБез изменений: ${skipped}\nОшибок: ${errors}`, kbPostMenu());
    ctx.session.postWizard.step = 'menu';
  });

  // "Назад" только для /post (анкета перехватит раньше своим hears с next())
  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (ctx.session?.order) return next();
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard) return;

    ctx.session.postWizard.step = 'menu';
    await ctx.reply('Меню /post:', kbPostMenu());
  });

  bot.hears('▶️ Новая публикация', async (ctx) => {
    if (!isAdmin(ctx)) return;
    if (!ctx.session?.postWizard || ctx.session.postWizard.step !== 'menu') return;

    ctx.session.postWizard.step = 'STELA';
    await askStep(ctx, 'STELA');
  });

  async function askStep(ctx, group) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const list = items.filter((it) => it.group === group);

    if (!list.length) return advance(ctx);

    const buttons = list.map((it) => it.label);
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));

    const optional = ['CVETNIK', 'PLITA', 'WORK'];
    if (optional.includes(group)) rows.push(['— Нет —']);

    rows.push(['Отменить']);

    const titleMap = {
      STELA: 'Выберите стелу:',
      TUMBA: 'Выберите тумбу:',
      CVETNIK: 'Цветник (или — Нет —):',
      PLITA: 'Плита (или — Нет —):',
      WORK: 'Работа (или — Нет —):',
      OPTION: 'Опции (можно несколько):',
      GRAFIKA: 'Графика (можно несколько). Нажмите «Далее» когда закончите:',
    };

    if (group === 'OPTION' || group === 'GRAFIKA') {
      rows.unshift(['Далее', 'Сбросить']);
      await ctx.reply(titleMap[group] || `Выберите ${group}:`, Markup.keyboard(rows).resize());
      return;
    }

    await ctx.reply(titleMap[group] || `Выберите ${group}:`, Markup.keyboard(rows).resize());
  }

  async function advance(ctx) {
    const wiz = ctx.session.postWizard;
    if (!wiz) return;

    const order = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK', 'OPTION', 'GRAFIKA', 'PREVIEW'];
    const idx = order.indexOf(wiz.step);
    wiz.step = order[idx + 1] || 'PREVIEW';

    if (wiz.step === 'PREVIEW') return preview(ctx);
    return askStep(ctx, wiz.step);
  }

  async function preview(ctx) {
    const wiz = ctx.session.postWizard;
    const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
    const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

    const baseText = (wiz.baseTextNoHint || '').trim();
    const fullCaption = baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`;

    wiz.step = 'CONFIRM';
    wiz._previewTotal = total;

    await ctx.reply(
      `Предпросмотр:\n\n${fullCaption}\n\nЕсли всё верно — нажмите «Опубликовать».`,
      Markup.keyboard([['Опубликовать'], ['Отменить']]).resize()
    );
  }

  bot.on('message', async (ctx, next) => {
    const wiz = ctx.session?.postWizard;
    if (!wiz) return next();

    if ('text' in ctx.message && ctx.message.text?.trim() === 'Отменить') {
      ctx.session.postWizard = null;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return;
    }

    // update-by-forward flow
    if (wiz.step === 'update_wait_forward') {
      const fwd = ctx.message?.forward_from_chat;
      const messageId = ctx.message?.forward_from_message_id;

      if (!fwd || !messageId) {
        await ctx.reply('Это не пересланный пост из канала. Перешлите именно сообщение из канала.', kbPostCancelOnly());
        return;
      }

      const channelId = getChannelId();
      if (!channelId) {
        await ctx.reply('CHANNEL_ID не задан.', kbPostMenu());
        ctx.session.postWizard.step = 'menu';
        return;
      }

      if (String(fwd.id) !== String(channelId)) {
        await ctx.reply('Пост переслан не из того канала.', kbPostCancelOnly());
        return;
      }

      const meta = await getCatalogPostMeta(messageId);
      if (!meta?.selected) {
        await ctx.reply(
          'У меня нет сохранённого состава для этого поста.\nОн должен быть опубликован через мастер /post.',
          kbPostMenu()
        );
        ctx.session.postWizard.step = 'menu';
        return;
      }

      const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const { caption, total } = calcCaptionAndTags(catalog, meta.selected);
      const baseText = (meta.baseTextNoHint || '').trim();
      const newCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

      await ctx.telegram.editMessageCaption(channelId, messageId, undefined, newCaption);
      await setCatalogPostMeta(messageId, { ...meta, last_total_price: total, updatedAt: Date.now() });

      await ctx.reply(`Обновлено.\nmessage_id: ${messageId}`, kbPostMenu());
      ctx.session.postWizard.step = 'menu';
      return;
    }

    if (!('text' in ctx.message) || !ctx.message.text) return;
    const text = ctx.message.text.trim();

    if (wiz.step === 'CONFIRM') {
      if (text === 'Опубликовать') {
        const catalog = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
        const { caption, total } = calcCaptionAndTags(catalog, wiz.selected);

        const baseText = (wiz.baseTextNoHint || '').trim();
        const finalCaption = (baseText ? `${baseText}\n\n${caption}\n\n${HINT_TEXT}` : `${caption}\n\n${HINT_TEXT}`).slice(0, 1024);

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

        // сохраняем мету поста для пересчёта цены
        await setCatalogPostMeta(primary.message_id, {
          selected: wiz.selected,
          baseTextNoHint: baseText,
          last_total_price: total,
          createdAt: Date.now(),
        });

        ctx.session.postWizard = null;
        await ctx.reply(`Опубликовано.\nmessage_id: ${primary.message_id}`, Markup.removeKeyboard());
      }
      return;
    }

    if (wiz.step === 'OPTION' || wiz.step === 'GRAFIKA') {
      if (text === 'Далее') return advance(ctx);
      if (text === 'Сбросить') {
        wiz.selected[wiz.step] = [];
        return askStep(ctx, wiz.step);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const it = items.find((x) => x.group === wiz.step && x.label === text);
      if (!it) return;

      const arr = Array.isArray(wiz.selected[wiz.step]) ? wiz.selected[wiz.step] : [];
      const idx = arr.indexOf(it.sku);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(it.sku);
      wiz.selected[wiz.step] = arr;
      return;
    }

    const singleGroups = ['STELA', 'TUMBA', 'CVETNIK', 'PLITA', 'WORK'];
    if (singleGroups.includes(wiz.step)) {
      if (text === '— Нет —') {
        wiz.selected[wiz.step] = null;
        return advance(ctx);
      }

      const { items } = await loadCatalogFromXlsx(CATALOG_XLSX_PATH);
      const it = items.find((x) => x.group === wiz.step && x.label === text);
      if (!it) return;

      wiz.selected[wiz.step] = it.sku;
      return advance(ctx);
    }
  });
}
