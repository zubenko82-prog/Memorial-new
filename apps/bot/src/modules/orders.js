// apps/bot/src/modules/orders.js
import { Markup } from 'telegraf';

// ---- утилиты ----
const normStr = (v) => String(v || '').trim();

// достаём из текста поста строку с ценой "Цена: ..."
function extractPriceLineFromPostText(text) {
  if (!text) return '';
  const lines = String(text).split('\n').map((l) => l.trim());
  // ищем первую строку, которая начинается с "Цена:"
  const line = lines.find((l) => /^Цена\s*:/i.test(l));
  return line || '';
}

// собираем только ссылку на пост и строку с ценой из текста поста
async function buildPostInfo(sourceToken, makePostLink, getPostMeta) {
  let postLink = '';
  let priceLine = '';

  if (!sourceToken || typeof getPostMeta !== 'function') {
    return { postLink, priceLine };
  }

  const postMeta = await getPostMeta(sourceToken).catch(() => null);
  if (!postMeta) return { postLink, priceLine };

  // ссылка на пост
  if (postMeta.messageId) {
    const absChatId = postMeta.absChatId;
    postLink = makePostLink(absChatId, postMeta.messageId);
  }

  // цена — просто извлекаем строку "Цена: ..." из текста поста
  if (postMeta.text) {
    const price = extractPriceLineFromPostText(postMeta.text);
    if (price) priceLine = price;
  }

  return { postLink, priceLine };
}

async function buildManagerSummary(
  s,
  orderNo,
  user,
  {
    sourceToken,
    makePostLink,
    getPostMeta,
  }
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
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];

  if (s.comment?.trim()) lines.push(`Комментарий/способ связи: ${s.comment.trim()}`);

  // информация о посте: ссылка + цена строкой из поста
  try {
    const { postLink, priceLine } = await buildPostInfo(sourceToken, makePostLink, getPostMeta);

    if (postLink || priceLine) {
      lines.push('');
      lines.push('🪦 Пост, с которого пришла заявка:');
      if (priceLine) lines.push(priceLine);
      if (postLink) lines.push(`Ссылка: ${postLink}`);
    }
  } catch (e) {
    console.error('[orders] buildManagerSummary post-info error', e?.message || e);
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
    makePostLink,
    MANAGER_CHAT_ID,

    CHANNEL_USERNAME,
    WEBAPP_URL,
    getPostMeta,
  } = deps;

  // более "живые" клавиатуры
  const kbName = () =>
    Markup.keyboard([['❌ Отменить']]).resize();

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

  const kbReview = () =>
    Markup.keyboard([
      ['📨 Отправить'],
      ['⬅️ Назад', '❌ Отменить'],
    ]).resize();

  const kbRemove = () => Markup.removeKeyboard();

  const stepOrder = ['name', 'phone', 'fio', 'dates', 'photos', 'comment', 'review'];

  function getOrder(ctx) {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.order) ctx.session.order = { step: 'name', photos: [] };
    return ctx.session.order;
  }

  async function renderStep(ctx) {
    const s = getOrder(ctx);
    const st = s.step;

    console.log('[orders] renderStep', st);

    if (st === 'name') {
      return ctx.reply(
        '👋 Добро пожаловать!\n\nШаг 1 из 6.\n\n✍️ Пожалуйста, укажите, как к вам обращаться (ФИО или имя):',
        kbName()
      );
    }
    if (st === 'phone') {
      return ctx.reply(
        '📞 Шаг 2 из 6. Контактный телефон.\n\nВы можете:\n• отправить номер кнопкой «📱 Отправить мой контакт»\n• или ввести номер вручную в формате +7...\n\nНаш менеджер свяжется с вами по этому номеру.',
        kbPhone()
      );
    }
    if (st === 'fio') {
      return ctx.reply(
        '🕊 Шаг 3 из 6. ФИО усопшего.\n\nНапишите фамилию, имя и отчество так, как они должны быть на памятнике.',
        kbBackCancel()
      );
    }
    if (st === 'dates') {
      return ctx.reply(
        '📅 Шаг 4 из 6. Даты.\n\nУкажите даты в формате:\n\n<b>DD.MM.YYYY - DD.MM.YYYY</b>\nНапример:\n12.03.1950 - 05.11.2020',
        {
          parse_mode: 'HTML',
          ...kbBackCancel(),
        }
      );
    }
    if (st === 'photos') {
      return ctx.reply(
        '🖼 Шаг 5 из 6. Фотографии.\n\nПрикрепите одно или несколько фото для примера.\n\n⚠️ Важно:\n• Не нажимайте «➡️ Далее», пока не увидите ответ:\n<b>«✅ Фото загружено. Можно продолжить»</b>.\n• После каждой отправки фото бот подтверждает его загрузку.\n\nКогда все нужные фото отправлены и вы увидели подтверждение — нажимайте «➡️ Далее».',
        {
          parse_mode: 'HTML',
          ...kbPhotos(),
        }
      );
    }
    if (st === 'comment') {
      return ctx.reply(
        '💬 Шаг 6 из 6. Комментарий и способ связи.\n\nНапишите дополнительные пожелания:\n• удобное время для звонка\n• альтернативный способ связи (WhatsApp, Viber и т.п.)\n• особые требования к памятнику.\n\nЕсли комментариев нет — просто нажмите «✅ Продолжить».',
        kbComment()
      );
    }
    if (st === 'review') {
      return stepReview(ctx);
    }

    s.step = 'name';
    return ctx.reply(
      '👋 Добро пожаловать!\n\nШаг 1 из 6.\n\n✍️ Пожалуйста, укажите, как к вам обращаться (ФИО или имя):',
      kbName()
    );
  }

  async function stepBack(ctx) {
    const s = ctx.session?.order;
    if (!s?.step) return;

    const idx = stepOrder.indexOf(s.step);
    s.step = stepOrder[Math.max(0, idx - 1)];
    console.log('[orders] stepBack to', s.step);
    return renderStep(ctx);
  }

  async function startOrder(ctx, sourceToken) {
    console.log('[orders] startOrder, sourceToken =', sourceToken);
    ctx.session.order = {
      step: 'name',
      photos: [],
      ...(sourceToken ? { sourceToken } : {}),
    };
    return renderStep(ctx);
  }

  async function stepReview(ctx) {
    const s = getOrder(ctx);
    s.step = 'review';
    if (!s.orderNo) s.orderNo = makeOrderNo();

    const lines = [
      `📄 Предпросмотр заявки №${s.orderNo}`,
      '',
      '',
      'Проверьте, пожалуйста, данные:',
      '',
      `👤 Заказчик: ${s.name || '—'}`,
      `📞 Телефон: ${s.phone || '—'}`,
      '',
      `🕊 На памятнике: ${s.fio?.trim() || '-'}`,
      '',
      `📅 Даты: ${s.dates?.trim() || '-'}`,
      s.photos?.length ? `🖼 Фото: ${s.photos.length} шт.` : '🖼 Фото: не прикреплены',
      s.comment?.trim() ? `💬 Комментарий/связь: ${s.comment.trim()}` : '💬 Комментарий/связь: —',
      '',
      'Если всё верно — нажмите «📨 Отправить».',
      'Если хотите что-то изменить — используйте «⬅️ Назад».',
    ];

    console.log('[orders] stepReview, orderNo =', s.orderNo);
    await ctx.reply(lines.join('\n'), kbReview());
  }

  async function sendOrderToManager(ctx, s, orderNo) {
    if (!MANAGER_CHAT_ID) throw new Error('MANAGER_CHAT_ID is not set');

    const managerText = await buildManagerSummary(s, orderNo, ctx.from, {
      sourceToken: s.sourceToken,
      makePostLink,
      getPostMeta,
    });

    console.log(
      '[orders] sendOrderToManager, MANAGER_CHAT_ID =',
      MANAGER_CHAT_ID,
      'photos =',
      s.photos?.length || 0
    );

    const photos = Array.isArray(s.photos) ? s.photos : [];
    if (photos.length > 0) {
      const media = photos.slice(0, 10).map((fileId, i) => ({
        type: 'photo',
        media: fileId,
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
    console.log('[orders] submitOrder called, step =', s.step);

    if (!s.name || !s.phone || !phoneOk(s.phone)) {
      console.log('[orders] submitOrder validation failed', { name: s.name, phone: s.phone });
      return ctx.reply(
        '❗️ Обязательные поля не заполнены.\n\nПроверьте, пожалуйста:\n• «Заказчик»\n• «Номер телефона»\n\nВернитесь на шаг назад, внесите данные и повторите отправку.',
        kbName()
      );
    }

    const orderNo = s.orderNo || makeOrderNo();

    try {
      await sendOrderToManager(ctx, s, orderNo);

      const webAppUrl = WEBAPP_URL ? new URL(WEBAPP_URL).toString() : null;

      const row = [];
      // КНОПКУ ПЕРЕЙТИ В КАНАЛ УБИРАЕМ, оставляем только подбор памятника
      if (webAppUrl) row.push(Markup.button.webApp('📐 Подобрать памятник', webAppUrl));

      const replyMarkup =
        row.length > 0
          ? {
              reply_markup: {
                ...Markup.inlineKeyboard([row]).reply_markup,
                ...kbRemove().reply_markup,
              },
            }
          : kbRemove();

      console.log('[orders] submitOrder OK, orderNo =', orderNo);
      await ctx.reply(
        [
          `✅ Заявка №${orderNo} отправлена.`,
          '',
          `${s.name || 'Спасибо'}! Наш менеджер свяжется с вами по указанному телефону в ближайшее время.`,
          CHANNEL_USERNAME ? `\nНаш канал: https://t.me/${CHANNEL_USERNAME}` : '',
        ]
          .join('\n')
          .trim(),
        replyMarkup
      );
    } catch (e) {
      const desc = e?.response?.description || e?.message || String(e);
      console.error('[orders] submitOrder error', desc);
      await ctx.reply('😔 Не удалось отправить заявку. Попробуйте позже или свяжитесь с нами другим способом.', kbRemove());
    } finally {
      ctx.session.order = null;
    }
  }

  async function cancelOrder(ctx, msg = 'Анкета отменена.') {
    console.log('[orders] cancelOrder');
    ctx.session.order = null;
    return ctx.reply(`❌ ${msg}`, kbRemove());
  }

  // -------- handlers --------

  bot.start(async (ctx) => {
    console.log('[orders] bot.start, text =', ctx.message?.text);

    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();

    let sourceToken = null;
    const prefix = `${DEEPLINK_PREFIX}_`;
    if (arg.startsWith(prefix)) {
      sourceToken = arg.slice(prefix.length);
    }

    await ctx.reply(HINT_TEXT);
    await startOrder(ctx, sourceToken || undefined);
  });

  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена по команде /cancel.'));

  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (!ctx.session?.order) return next();
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
    console.log('[orders] hears Отправить, step =', ctx.session?.order?.step);
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
    return next();
  });

  bot.on('message', async (ctx, next) => {
    const st = ctx.session?.order?.step;
    if (!st) return next();

    console.log('[orders] on message, step =', st);

    const s = getOrder(ctx);

    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact?.phone_number) {
      const num = ctx.message.contact.phone_number;
      s.tg_phone = num;
      s.phone = num;
      s.step = 'fio';
      return renderStep(ctx);
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();

      if (st === 'name') {
        s.name = text;
        s.step = 'phone';
        return renderStep(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            '⚠️ Пожалуйста, введите корректный номер телефона (минимум 6 цифр, можно с +)\nили нажмите «📱 Отправить мой контакт».',
            kbPhone()
          );
        }
        s.phone = text;
        s.step = 'fio';
        return renderStep(ctx);
      }
      if (st === 'fio') {
        s.fio = text;
        s.step = 'dates';
        return renderStep(ctx);
      }
      if (st === 'dates') {
        s.dates = text;
        s.step = 'photos';
        return renderStep(ctx);
      }
      if (st === 'comment') {
        if (!['✅ Продолжить', 'Продолжить', '❌ Отменить', 'Отменить'].includes(text)) {
          s.comment = text;
          return ctx.reply(
            '✍️ Комментарий сохранён.\nЕсли готовы перейти к итоговому просмотру заявки — нажмите «✅ Продолжить».',
            kbComment()
          );
        }
      }
    }

    if ('photo' in ctx.message && ctx.message.photo?.length) {
      if (st === 'photos') {
        const fileId = ctx.message.photo.at(-1)?.file_id;
        if (fileId) {
          s.photos = s.photos || [];
          s.photos.push(fileId);
          return ctx.reply(
            '✅ Фото загружено.\nВы можете отправить ещё фото, если нужно.\nКогда все фото будут прикреплены, нажмите «➡️ Далее», чтобы продолжить.',
            kbPhotos()
          );
        }
      }
    }

    return next();
  });
}
