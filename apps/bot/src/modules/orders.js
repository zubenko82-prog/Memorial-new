// apps/bot/src/modules/orders.js
import { Markup } from 'telegraf';

// ---- утилиты ----
const normStr = (v) => String(v || '').trim();

function extractPriceLineFromPostText(text) {
  if (!text) return '';
  const lines = String(text).split('\n').map((l) => l.trim());
  const line = lines.find((l) => /^Цена\s*:/i.test(l));
  return line || '';
}

function extractCompositionAndTotalFromPostText(text) {
  if (!text) return { compositionLines: [], totalLine: '' };
  const lines = String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let totalLine = '';
  let priceLineIdx = -1;

  lines.forEach((l, idx) => {
    if (!totalLine && /^Итого\s*:/i.test(l)) totalLine = l;
    if (priceLineIdx === -1 && /^Цена\s*:/i.test(l)) priceLineIdx = idx;
  });

  let compositionLines = [];
  if (priceLineIdx !== -1) {
    const untilIdx = totalLine
      ? lines.findIndex((l, i) => i > priceLineIdx && /^Итого\s*:/i.test(l))
      : -1;
    const end = untilIdx === -1 ? lines.length : untilIdx;
    compositionLines = lines.slice(priceLineIdx + 1, end).filter((l) => l && !/^Итого\s*:/i.test(l));
  }

  return { compositionLines, totalLine };
}

async function getPostInfo(sourceToken, getPostMeta, makePostLink) {
  if (!sourceToken || typeof getPostMeta !== 'function') {
    return { priceLine: '', postUrl: '', compositionLines: [], totalLine: '' };
  }

  const meta = await getPostMeta(sourceToken).catch((e) => {
    console.error('[orders] getPostInfo getPostMeta error', e?.message || e);
    return null;
  });

  if (!meta) return { priceLine: '', postUrl: '', compositionLines: [], totalLine: '' };

  const text = meta.text || '';
  const priceLine = extractPriceLineFromPostText(text);
  const { compositionLines, totalLine } = extractCompositionAndTotalFromPostText(text);

  let postUrl = '';
  try {
    if (typeof makePostLink === 'function') {
      const absChatId = meta.absChatId || null;
      const messageId = meta.messageId || null;
      postUrl = makePostLink(absChatId, messageId) || '';
    }
  } catch (e) {
    console.error('[orders] getPostInfo makePostLink error', e?.message || e);
  }

  return { priceLine, postUrl, compositionLines, totalLine };
}

async function buildManagerSummary(
  s,
  orderNo,
  user,
  { getPostMeta, makePostLink }
) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';

  const u = user || {};
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—';
  const username = u.username ? `@${u.username}` : '—';
  const lang = u.language_code || '—';
  const isPremium = u.is_premium ? 'да' : 'нет';

  const tgPhone = s.tg_phone ? s.tg_phone : null;

  const lines = [
    `🆕 Новая заявка №${orderNo}`,
    '',
    '👤 Данные Telegram:',
    `ID: ${u.id ?? '—'}`,
    `Имя: ${fullName}`,
    `Username: ${username}`,
    `Язык: ${lang}`,
    `Premium: ${isPremium}`,
    ...(tgPhone ? [`Телефон профиля (контакт): ${tgPhone}`] : []),
    '',
    '📋 Данные анкеты:',
    `Заказчик: ${s.name || '—'}`,
    `Телефон (в анкете): ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото клиента: ${s.photos.length} шт.` : 'Фото клиента: —',
  ];

  if (s.comment?.trim()) lines.push(`Комментарий/способ связи: ${s.comment.trim()}`);

  try {
    const { priceLine, postUrl, compositionLines, totalLine } = await getPostInfo(
      s.sourceToken,
      getPostMeta,
      makePostLink
    );

    if (compositionLines.length || totalLine || priceLine || postUrl) {
      lines.push('');

      if (compositionLines.length) {
        lines.push('🧩 Состав заказа (из поста):');
        lines.push(...compositionLines);
      }

      if (totalLine) {
        lines.push('');
        lines.push(`💰 ${totalLine}`);
      } else if (priceLine) {
        lines.push('');
        lines.push('💵 Цена в посте:');
        lines.push(priceLine);
      }

      if (postUrl) {
        lines.push('');
        lines.push('🔗 Пост в канале:');
        lines.push(postUrl);
      }
    }
  } catch (e) {
    console.error('[orders] buildManagerSummary post info error', e?.message || e);
  }

  return lines.join('\n');
}

export function registerOrders(bot, deps) {
  console.log('[orders] registerOrders called');

  const {
    HINT_TEXT,
    DEEPLINK_PREFIX,
    phoneOk,
    makeOrderNo,
    MANAGER_CHAT_ID,
    CHANNEL_USERNAME,
    WEBAPP_URL,
    getPostMeta,
    makePostLink,
  } = deps;

  // --- главное меню предпросмотра
  const kbReview = () =>
    Markup.keyboard([
      ['📨 Отправить'],
      ['✏️ Изменить'],
      ['⬅️ Назад', '❌ Отменить'],
    ]).resize();

  // --- меню редактирования (ДВА СТОЛБЦА, только пиктограммы)
  const kbEditMenu = () =>
    Markup.keyboard([
      ['📝Имя', '📞Телефон'],
      ['🕊ФИО', '📅Даты'],
      ['🖼Фото', '💬Комментарий'],
      ['⬅️ Назад'],
    ]).resize();

  const kbName = () => Markup.keyboard([['❌ Отменить']]).resize();
  const kbPhone = () =>
    Markup.keyboard([
      [Markup.button.contactRequest('📱 Отправить мой контакт')],
      ['⬅️ Назад', '❌ Отменить'],
    ]).resize();
  const kbBackCancel = () =>
    Markup.keyboard([['⬅️ Назад', '❌ Отменить']]).resize();
  const kbPhotos = () =>
    Markup.keyboard([
      ['➡️ Далее'],
      ['⬅️ Назад', '❌ Отменить'],
    ]).resize();
  const kbComment = () =>
    Markup.keyboard([
      ['✅ Продолжить'],
      ['⬅️ Назад', '❌ Отменить'],
    ]).resize();
  const kbRemove = () => Markup.removeKeyboard();

  const stepOrder = ['name', 'phone', 'fio', 'dates', 'photos', 'comment', 'review', 'edit_menu'];

  function getOrder(ctx) {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.order) ctx.session.order = { step: 'name', photos: [] };
    return ctx.session.order;
  }

  // ---------- шаги анкеты ----------
  async function renderStep(ctx) {
    const s = getOrder(ctx);
    const st = s.step;

    switch (st) {
      case 'name':
        return ctx.reply('👋 Добро пожаловать!\n\nШаг 1 из 6.\n\n✍️ Укажите, как к вам обращаться (ФИО или имя):', kbName());
      case 'phone':
        return ctx.reply(
          '📞 Шаг 2 из 6. Контактный телефон.\nВы можете:\n• отправить номер кнопкой «📱»\n• или ввести номер вручную в формате +7...',
          kbPhone()
        );
      case 'fio':
        return ctx.reply('🕊 Шаг 3 из 6. ФИО усопшего.\nНапишите фамилию, имя и отчество так, как они должны быть на памятнике.', kbBackCancel());
      case 'dates':
        return ctx.reply(
          '📅 Шаг 4 из 6. Даты.\nУкажите даты в формате:\nDD.MM.YYYY - DD.MM.YYYY\nНапример:\n12.03.1950 - 05.11.2020',
          { parse_mode: 'HTML', ...kbBackCancel() }
        );
      case 'photos':
        return ctx.reply(
          '🖼 Шаг 5 из 6. Фотографии.\n(Можно без фото — жмите «➡️ Далее»)\nПрикрепите фото для примера.\nКогда все нужные фото отправлены, нажмите «➡️ Далее».',
          { parse_mode: 'HTML', ...kbPhotos() }
        );
      case 'comment':
        return ctx.reply(
          '💬 Шаг 6 из 6. Комментарий, способ связи или промокод.\nЕсли комментариев нет — просто нажмите «✅ Продолжить».',
          kbComment()
        );
      case 'review':
        return stepReview(ctx);
      case 'edit_menu':
        return ctx.reply('Что хотите изменить?', kbEditMenu());
      default:
        s.step = 'name';
        return ctx.reply('👋 Добро пожаловать! Укажите, как к вам обращаться (ФИО или имя):', kbName());
    }
  }

  async function stepBack(ctx) {
    const s = ctx.session?.order;
    if (!s?.step) return;

    // спец-обработка из меню редактирования
    if (s.step === 'edit_menu') {
      s.step = 'review';
      return stepReview(ctx);
    }

    const idx = stepOrder.indexOf(s.step);
    s.step = stepOrder[Math.max(0, idx - 1)];
    return renderStep(ctx);
  }

  async function startOrder(ctx, sourceToken) {
    ctx.session.order = { step: 'name', photos: [], ...(sourceToken ? { sourceToken } : {}) };
    return renderStep(ctx);
  }

  async function stepReview(ctx) {
    const s = getOrder(ctx);
    s.step = 'review';
    if (!s.orderNo) s.orderNo = makeOrderNo();

    const lines = [
      `📄 Предпросмотр заявки №${s.orderNo}`,
      '',
      `👤 Заказчик: ${s.name || '—'}`,
      `📞 Телефон: ${s.phone || '—'}`,
      `🕊 Усопшие: ${s.fio?.trim() || '-'}`,
      `📅 Даты: ${s.dates?.trim() || '-'}`,
      s.photos?.length ? `🖼 Фото: ${s.photos.length} шт.` : '🖼 Фото: не прикреплены',
      s.comment?.trim() ? `💬 Комментарий/связь: ${s.comment.trim()}` : null,
      '',
      'Используйте кнопку "✏️ Изменить", чтобы исправить любой блок.',
      'Если всё верно — нажмите «📨 Отправить».',
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'), kbReview());
  }

  // ---------- отправка менеджеру ----------
  async function sendOrderToManager(ctx, s, orderNo) {
    if (!MANAGER_CHAT_ID) throw new Error('MANAGER_CHAT_ID is not set');
    const managerText = await buildManagerSummary(s, orderNo, ctx.from, { getPostMeta, makePostLink });

    const photos = Array.isArray(s.photos) ? s.photos : [];
    if (photos.length > 0) {
      const media = photos.slice(0, 10).map((pFileId, i) => ({
        type: 'photo',
        media: pFileId,
        ...(i === 0 ? { caption: managerText } : {}),
      }));
      await ctx.telegram.sendMediaGroup(MANAGER_CHAT_ID, media);

      if (photos.length > 10) {
        await ctx.telegram.sendMessage(
          MANAGER_CHAT_ID,
          `Дополнительные фото (${photos.length - 10} шт.) пользователь отправит отдельно.`
        );
      }
    } else {
      await ctx.telegram.sendMessage(MANAGER_CHAT_ID, managerText);
    }
  }

  async function submitOrder(ctx) {
    const s = getOrder(ctx);
    if (!s.name || !s.phone || !phoneOk(s.phone)) {
      return ctx.reply('❗️ Обязательные поля не заполнены.\nПроверьте: «Заказчик», «Номер телефона».', kbName());
    }
    const orderNo = s.orderNo || makeOrderNo();
    try {
      await sendOrderToManager(ctx, s, orderNo);

      const webAppUrl = WEBAPP_URL ? new URL(WEBAPP_URL).toString() : null;
      const row = [];
      if (webAppUrl) row.push(Markup.button.webApp('🪦 Подобрать памятник', webAppUrl));
      const replyMarkup =
        row.length > 0
          ? {
              reply_markup: {
                ...Markup.inlineKeyboard([row]).reply_markup,
                ...kbRemove().reply_markup,
              },
            }
          : kbRemove();

      await ctx.reply(
        [
          `✅ Заявка №${orderNo} отправлена.`,
          `${s.name || 'Спасибо'}! Наш менеджер свяжется с вами по указанному телефону.`,
          CHANNEL_USERNAME ? `\nНаш канал: https://t.me/${CHANNEL_USERNAME}` : '',
        ].filter(Boolean).join('\n'),
        replyMarkup
      );
    } catch (e) {
      await ctx.reply('😔 Не удалось отправить заявку. Попробуйте позже.', kbRemove());
    } finally {
      ctx.session.order = null;
    }
  }

  async function cancelOrder(ctx, msg = 'Анкета отменена.') {
    ctx.session.order = null;
    return ctx.reply(`❌ ${msg}`, kbRemove());
  }

  // ====== Меню редактирования ======
  bot.hears(['✏️ Изменить'], async (ctx) => {
    const s = getOrder(ctx);
    s.step = 'edit_menu';
    await ctx.reply('Что хотите изменить?', kbEditMenu());
  });

  bot.hears('📝Имя', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'name'; await renderStep(ctx);
  });
  bot.hears('📞Телефон', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'phone'; await renderStep(ctx);
  });
  bot.hears('🕊ФИО', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'fio'; await renderStep(ctx);
  });
  bot.hears('📅Даты', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'dates'; await renderStep(ctx);
  });
  bot.hears('🖼Фото', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'photos'; await renderStep(ctx);
  });
  bot.hears('💬Комментарий', async (ctx) => {
    const s = getOrder(ctx);
    s.editReturnStep = 'review'; s.step = 'comment'; await renderStep(ctx);
  });

  bot.hears(['⬅️ Назад'], async (ctx, next) => {
    const s = getOrder(ctx);
    if (s.step === 'edit_menu') {
      s.step = 'review';
      return stepReview(ctx);
    }
    return stepBack(ctx);
  });

  bot.hears(['Отменить', '❌ Отменить'], async (ctx, next) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
    return next();
  });

  bot.hears(['➡️ Далее', 'Далее'], async (ctx, next) => {
    if (ctx.session?.order?.step === 'photos') {
      ctx.session.order.step = 'comment';
      return renderStep(ctx);
    }
    return next();
  });

  bot.hears(['✅ Продолжить', 'Продолжить'], async (ctx, next) => {
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
    return next();
  });

  bot.hears(['📨 Отправить', 'Отправить'], async (ctx, next) => {
    if (ctx.session?.order?.step === 'review')
      return submitOrder(ctx);
    return next();
  });

  bot.on('message', async (ctx, next) => {
    const s = getOrder(ctx);
    const st = s.step;
    if (!st) return next();

    // Если после редактирования — возвращаем к предпросмотру
    const restoreToReview = () => {
      if (s.editReturnStep === 'review') {
        s.step = 'review';
        delete s.editReturnStep;
        return stepReview(ctx);
      }
    };

    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact?.phone_number) {
      const num = ctx.message.contact.phone_number;
      s.tg_phone = num;
      s.phone = num;
      s.step = 'fio';
      await renderStep(ctx);
      return restoreToReview();
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();
      if (st === 'name') {
        s.name = text;
        s.step = 'phone';
        await renderStep(ctx);
        return restoreToReview();
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            '⚠️ Введите корректный номер телефона (минимум 6 цифр, можно с +)\nили нажмите «📱» для автоматической отправки.',
            kbPhone()
          );
        }
        s.phone = text;
        s.step = 'fio';
        await renderStep(ctx);
        return restoreToReview();
      }
      if (st === 'fio') {
        s.fio = text;
        s.step = 'dates';
        await renderStep(ctx);
        return restoreToReview();
      }
      if (st === 'dates') {
        s.dates = text;
        s.step = 'photos';
        await renderStep(ctx);
        return restoreToReview();
      }
      if (st === 'comment') {
        if (!['✅ Продолжить', 'Продолжить', '❌ Отменить', 'Отменить'].includes(text)) {
          s.comment = text;
          await ctx.reply(
            '✍️ Комментарий сохранён.\nЕсли готовы перейти к итоговому просмотру заявки — нажмите «✅ Продолжить».',
            kbComment()
          );
          return restoreToReview();
        }
      }
    }

    if ('photo' in ctx.message && ctx.message.photo?.length) {
      if (st === 'photos') {
        const fileId = ctx.message.photo.at(-1)?.file_id;
        if (fileId) {
          s.photos = s.photos || [];
          s.photos.push(fileId);
          await ctx.reply(
            '✅ Фото загружено.\nМожно отправить ещё фото или нажать «➡️ Далее».',
            kbPhotos()
          );
          return restoreToReview();
        }
      }
    }

    return next();
  });
}