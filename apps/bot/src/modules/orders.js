// apps/bot/src/modules/orders.js
import { Markup } from 'telegraf';

function makeSourceTokenForPost(absChatId, messageId) {
  return `p_${absChatId}_${messageId}_x`;
}
function parseSourceTokenToPostRef(sourceToken) {
  const m = /^p_(\d+)_(\d+)_/.exec(String(sourceToken || ''));
  if (!m) return null;
  return { absChatId: Number(m[1]), messageId: Number(m[2]) };
}

function buildManagerSummary(s, orderNo, user, postLink) {
  const fio = s.fio?.trim() || '-';
  const dates = s.dates?.trim() || '-';

  const u = user || {};
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—';
  const username = u.username ? `@${u.username}` : '—';
  const lang = u.language_code || '—';
  const isPremium = u.is_premium ? 'да' : 'нет';

  const tgPhone = s.tg_phone ? s.tg_phone : null;

  const lines = [
    `Новая заявка №${orderNo}`,
    '',
    'Данные Telegram:',
    `ID: ${u.id ?? '—'}`,
    `Имя: ${fullName}`,
    `Username: ${username}`,
    `Язык: ${lang}`,
    `Premium: ${isPremium}`,
    ...(tgPhone ? [`Телефон профиля (контакт): ${tgPhone}`] : []),
    '',
    'Данные анкеты:',
    `Заказчик: ${s.name || '—'}`,
    `Телефон (в анкете): ${s.phone || '—'}`,
    `ФИО усопшего: ${fio}`,
    `Даты: ${dates}`,
    s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
  ];

  if (s.comment?.trim()) lines.push(`Комментарий/связь: ${s.comment.trim()}`);
  if (postLink) lines.push('', `Ссылка на пост: ${postLink}`);

  return lines.join('\n');
}

export function registerOrders(bot, deps) {
  const { HINT_TEXT, DEEPLINK_PREFIX, phoneOk, makeOrderNo, makePostLink, MANAGER_CHAT_ID } = deps;

  // ---- клавиатуры анкеты
  const kbName = () => Markup.keyboard([['Отменить']]).resize();
  const kbPhone = () =>
    Markup.keyboard([[Markup.button.contactRequest('📱 Отправить мой контакт')], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbBackCancel = () => Markup.keyboard([['⬅️ Назад'], ['Отменить']]).resize();
  const kbPhotos = () => Markup.keyboard([['Далее'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbComment = () => Markup.keyboard([['Продолжить'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbReview = () => Markup.keyboard([['Отправить'], ['⬅️ Назад'], ['Отменить']]).resize();
  const kbRemove = () => Markup.removeKeyboard();

  const stepOrder = ['name', 'phone', 'fio', 'dates', 'photos', 'comment', 'review'];

  async function renderStep(ctx) {
    const st = ctx.session?.order?.step;

    if (st === 'name') return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
    if (st === 'phone') return ctx.reply('Шаг 2/6. Номер телефона (или нажмите «📱 Отправить мой контакт»):', kbPhone());
    if (st === 'fio') return ctx.reply('Шаг 3/6. Фамилия/Имя/Отчество усопшего:', kbBackCancel());
    if (st === 'dates')
      return ctx.reply(
        'Шаг 4/6. Дата рождения — Дата смерти (в формате DD.MM.YYYY - DD.MM.YYYY). Например: 12.03.1950 - 05.11.2020',
        kbBackCancel()
      );
    if (st === 'photos') return ctx.reply('Шаг 5/6. Прикрепите фото. Когда закончите — нажмите «Далее».', kbPhotos());
    if (st === 'comment')
      return ctx.reply('Шаг 6/6. Комментарий или дополнительный способ связи (по желанию):', kbComment());
    if (st === 'review') return stepReview(ctx);

    ctx.session.order.step = 'name';
    return ctx.reply('Шаг 1/6. Заказчик (ФИО/имя):', kbName());
  }

  async function stepBack(ctx) {
    const s = ctx.session?.order;
    if (!s?.step) return;

    const idx = stepOrder.indexOf(s.step);
    s.step = stepOrder[Math.max(0, idx - 1)];
    return renderStep(ctx);
  }

  async function startOrder(ctx, sourceToken) {
    ctx.session.order = { step: 'name', photos: [], ...(sourceToken ? { sourceToken } : {}) };
    return renderStep(ctx);
  }

  async function stepReview(ctx) {
    ctx.session.order.step = 'review';
    const s = ctx.session.order;
    if (!s.orderNo) s.orderNo = makeOrderNo();

    // Ссылка на пост: всегда из sourceToken (без Redis)
    let postLink = '';
    const ref = parseSourceTokenToPostRef(s.sourceToken);
    if (ref?.absChatId && ref?.messageId) {
      postLink = makePostLink(ref.absChatId, ref.messageId);
    }

    const lines = [
      `Заявка №${s.orderNo}:`,
      '',
      `Заказчик: ${s.name || '—'}`,
      `Телефон: ${s.phone || '—'}`,
      `ФИО усопшего: ${s.fio?.trim() || '-'}`,
      `Даты: ${s.dates?.trim() || '-'}`,
      s.photos?.length ? `Фото: ${s.photos.length} шт.` : 'Фото: —',
      s.comment?.trim() ? `Комментарий/связь: ${s.comment.trim()}` : null,
      postLink ? `Ссылка на пост: ${postLink}` : null,
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'), kbReview());
  }

  async function sendOrderToManager(ctx, s, orderNo) {
    const ref = parseSourceTokenToPostRef(s.sourceToken);
    const postLink = ref?.absChatId && ref?.messageId ? makePostLink(ref.absChatId, ref.messageId) : '';

    const managerText = buildManagerSummary(s, orderNo, ctx.from, postLink);

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
  const s = ctx.session.order || {};
  if (!s.name || !s.phone || !phoneOk(s.phone)) {
    return ctx.reply(
      'Обязательные поля не заполнены: «Заказчик» и/или «Номер телефона». Вернитесь и исправьте.',
      kbName()
    );
  }

  const orderNo = s.orderNo || makeOrderNo();

  const CHANNEL_URL = 'https://t.me/memorialDNR';
  const WEBAPP_URL = process.env.WEBAPP_URL;

  try {
    await sendOrderToManager(ctx, s, orderNo);

    // убрать reply-клавиатуру анкеты
    await ctx.reply(' ', kbRemove());

    await ctx.reply(
      `Заявка №${orderNo} отправлена. Спасибо, ${s.name}! Наш менеджер свяжется с вами по указанному номеру.\n\n` +
        `Вы можете перейти в канал: t.me/memorialDNR или подобрать памятник:`,
      Markup.inlineKeyboard([
        Markup.button.url('Перейти в канал', CHANNEL_URL),
        ...(WEBAPP_URL ? [Markup.button.webApp('Подобрать памятник', WEBAPP_URL)] : []),
      ])
    );
  } catch (e) {
    console.error('submitOrder error', e);
    await ctx.reply('Не удалось отправить заявку. Попробуйте позже.', kbRemove());
  } finally {
    ctx.session.order = null;
  }
}



  async function cancelOrder(ctx, msg = 'Отменено.') {
    ctx.session.order = null;
    return ctx.reply(msg, kbRemove());
  }

  // -------- handlers --------

  bot.start(async (ctx) => {
  const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();

  let sourceToken = null;
  const prefix = `${DEEPLINK_PREFIX}_`;
  if (arg.startsWith(prefix)) {
    sourceToken = arg.slice(prefix.length); // всё, что после prefix_
  }

  await ctx.reply(HINT_TEXT);
  await startOrder(ctx, sourceToken || undefined);
});


  bot.command('cancel', async (ctx) => cancelOrder(ctx, 'Анкета отменена.'));

  // ЕДИНСТВЕННЫЙ "Назад" для анкеты
  bot.hears('⬅️ Назад', async (ctx, next) => {
    if (!ctx.session?.order) return next();
    return stepBack(ctx);
  });

  bot.hears('Отменить', async (ctx) => {
    if (ctx.session?.order) return cancelOrder(ctx, 'Анкета отменена.');
  });

  bot.hears('Далее', async (ctx) => {
    if (ctx.session?.order?.step === 'photos') {
      ctx.session.order.step = 'comment';
      return renderStep(ctx);
    }
  });

  bot.hears('Продолжить', async (ctx) => {
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
  });

  bot.hears('Отправить', async (ctx) => {
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
  });

  bot.on('message', async (ctx, next) => {
    const st = ctx.session?.order?.step;
    if (!st) return next();

    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact?.phone_number) {
      const num = ctx.message.contact.phone_number;
      ctx.session.order.tg_phone = num;
      ctx.session.order.phone = num;
      ctx.session.order.step = 'fio';
      return renderStep(ctx);
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();

      if (st === 'name') {
        ctx.session.order.name = text;
        ctx.session.order.step = 'phone';
        return renderStep(ctx);
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            'Введите корректный номер телефона (минимум 6 цифр, можно с +) или нажмите «📱 Отправить мой контакт».',
            kbPhone()
          );
        }
        ctx.session.order.phone = text;
        ctx.session.order.step = 'fio';
        return renderStep(ctx);
      }
      if (st === 'fio') {
        ctx.session.order.fio = text;
        ctx.session.order.step = 'dates';
        return renderStep(ctx);
      }
      if (st === 'dates') {
        ctx.session.order.dates = text;
        ctx.session.order.step = 'photos';
        return renderStep(ctx);
      }
      if (st === 'comment') {
        if (text !== 'Продолжить' && text !== 'Отменить') {
          ctx.session.order.comment = text;
          return ctx.reply('Комментарий получен. Нажмите «Продолжить», чтобы перейти к сводке.', kbComment());
        }
      }
    }

    if ('photo' in ctx.message && ctx.message.photo?.length) {
      if (st === 'photos') {
        const fileId = ctx.message.photo.at(-1)?.file_id;
        if (fileId) {
          ctx.session.order.photos = ctx.session.order.photos || [];
          ctx.session.order.photos.push(fileId);
          return ctx.reply('Фото добавлено. Отправьте ещё или нажмите «Далее».', kbPhotos());
        }
      }
    }
  });
}
