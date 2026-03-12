// apps/bot/src/modules/orders.js
import { Markup } from 'telegraf';

function warningNote() {
  return '\n\n<b>🛑 ВАЖНО: \nЕсли допустили ошибку — не правьте сообщение. В конце заказа можно исправить через меню «✏️ Изменить».</b>';
}

const kbConfirmCancel = () => Markup.keyboard([['Да, отменить', 'Нет, вернуться']]).resize();

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
    const untilIdx = totalLine ? lines.findIndex((l, i) => i > priceLineIdx && /^Итого\s*:/i.test(l)) : -1;
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
  if (meta.absChatId && meta.messageId && typeof makePostLink === 'function') {
    postUrl = makePostLink(meta.absChatId, meta.messageId) || '';
  }

  return { priceLine, postUrl, compositionLines, totalLine };
}

function buildFormPreview(s) {
  return [
    `👤 ${s.name || '—'}`,
    `📞 ${s.phone || '—'}`,
    '',
    `🕊 ${s.fio?.trim() || '-'}`,
    `📅 ${s.dates?.trim() || '-'}`,
    '',
    s.photos?.length ? `🖼 ${s.photos.length} фото` : '🖼 —',
    '',
    s.comment?.trim() ? `💬 ${s.comment.trim()}` : '💬 —',
  ];
}

async function buildManagerSummary(s, orderNo, user, { getPostMeta, makePostLink }) {
  const u = user || {};
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || '—';
  const username = u.username ? `@${u.username}` : '—';
  const lang = u.language_code || '—';
  const isPremium = u.is_premium ? 'да' : 'нет';

  const tgPhone = s.tg_phone ? s.tg_phone : null;

  const lines = [
    `🆕 Новый заказ №${orderNo}`,
    '',
    '👤 Данные Telegram:',
    `ID: ${u.id ?? '—'}`,
    `Имя: ${fullName}`,
    `Username: ${username}`,
    `Язык: ${lang}`,
    `Premium: ${isPremium}`,
    ...(tgPhone ? [`Телефон профиля (контакт): ${tgPhone}`] : []),
    '',
    '📋 Данные заказа:',
    '',
    ...buildFormPreview(s),
    '',
  ];

  try {
    const { priceLine, postUrl, compositionLines, totalLine } = await getPostInfo(
      s.sourceToken,
      getPostMeta,
      makePostLink
    );
    if (compositionLines.length || totalLine || priceLine) {
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
    }
    if (postUrl) {
      lines.push('');
      lines.push('🔗 Пост в канале:');
      lines.push(postUrl);
    }
  } catch (e) {
    console.error('[orders] buildManagerSummary post info error', e?.message || e);
  }

  return lines.join('\n');
}

export function registerOrders(bot, deps) {
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

    // ✅ добавили
    showFilterMenu,
  } = deps;

  // === КНОПКИ ===
  const kbReview = () =>
    Markup.keyboard([['📨 Отправить'], ['✏️ Изменить'], ['🛑 Отменить заказ']]).resize();

  const kbEditMenu = () =>
    Markup.keyboard([
      ['📝Имя', '📞Телефон'],
      ['🕊ФИО', '📅Даты'],
      ['🖼Фото', '💬Комментарий'],
      ['↩️ Отменить изменения'],
      ['🛑 Отменить заказ'],
    ]).resize();

  const kbName = () => Markup.keyboard([['🛑 Отменить заказ']]).resize();

  const kbPhone = () =>
    Markup.keyboard([[Markup.button.contactRequest('📱 Отправить мой контакт')], ['🛑 Отменить заказ']]).resize();

  const kbPhotos = () => Markup.keyboard([['➡️ Далее'], ['🛑 Отменить заказ']]).resize();

  const kbComment = () => Markup.keyboard([['✅ Продолжить'], ['🛑 Отменить заказ']]).resize();

  const kbRemove = () => Markup.removeKeyboard();

  function getOrder(ctx) {
    if (!ctx.session) ctx.session = {};
    if (!ctx.session.order) ctx.session.order = { step: 'name', photos: [] };
    return ctx.session.order;
  }

  function rememberBeforeCancel(ctx) {
    const s = getOrder(ctx);
    if (!s._beforeCancelStep) s._beforeCancelStep = s.step || 'review';
  }

  async function goConfirmCancel(ctx) {
    const s = getOrder(ctx);
    rememberBeforeCancel(ctx);
    s.step = 'confirm_cancel';
    return renderStep(ctx);
  }

  async function renderStep(ctx) {
    const s = getOrder(ctx);
    const st = s.step;

    switch (st) {
      case 'name':
        return ctx.reply(
          '👋 Добро пожаловать!\n\nШаг 1 из 6.\n\n✍️ Представьтесь, как к вам обращаться (ФИО или имя):' + warningNote(),
          { parse_mode: 'HTML', ...kbName() }
        );
      case 'phone':
        return ctx.reply(
          '📞 Шаг 2 из 6. Контактный телефон.\nВы можете:\n• отправить номер кнопкой «📱»\n• или ввести номер вручную в формате +7...' + warningNote(),
          { parse_mode: 'HTML', ...kbPhone() }
        );
      case 'fio':
        return ctx.reply(
          '🕊 Шаг 3 из 6. ФИО усопшего.\nНапишите фамилию, имя и отчество так, как они должны быть на памятнике.' + warningNote(),
          { parse_mode: 'HTML', ...kbName() }
        );
      case 'dates':
        return ctx.reply(
          '📅 Шаг 4 из 6. Даты.\nУкажите даты в формате:\nDD.MM.YYYY - DD.MM.YYYY\nНапример:\n12.03.1950 - 05.11.2020' +
            warningNote(),
          { parse_mode: 'HTML', ...kbName() }
        );
      case 'photos':
        return ctx.reply(
          '🖼 Шаг 5 из 6. Фотографии.\n(Без фото — жмите «➡️ Далее»)\n\nЕсли цифрового файла нет - сфотографируйте фото на телефон.\n\nПри загрузке фотографии дождитесь сообщения,\n«✅ Фото загружено»,\nтолько после этого нажмите\n«➡️ Далее»' +
            warningNote(),
          { parse_mode: 'HTML', ...kbPhotos() }
        );
      case 'comment':
        return ctx.reply(
          '💬 Шаг 6 из 6. Комментарий, способ связи или промокод.\nЕсли комментариев нет — просто нажмите «✅ Продолжить».' +
            warningNote(),
          { parse_mode: 'HTML', ...kbComment() }
        );
      case 'review':
        return stepReview(ctx);
      case 'edit_menu':
        return ctx.reply('Что хотите изменить?', kbEditMenu());
      case 'confirm_cancel':
        return ctx.reply('Вы действительно хотите отменить заказ? Все введённые данные будут удалены.', kbConfirmCancel());
      default:
        s.step = 'name';
        return ctx.reply('👋 Добро пожаловать! Представтесь, как к вам обращаться (ФИО или имя):' + warningNote(), {
          parse_mode: 'HTML',
          ...kbName(),
        });
    }
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
      `📄 ${s.orderNo}`,
      '',
      '🔍 Проверьте данные перед отправкой',
      '',
      ...buildFormPreview(s),
      '',
      '',
      '«✏️ Изменить», исправить данные.',
      '«📨 Отправить», когда всё верно.',
    ];

    await ctx.reply(lines.join('\n'), kbReview());
  }

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

      await ctx.reply(
        [
          `✅ Заказ №${orderNo} отправлен.`,
          ``,
          `Спасибо ${s.name || ''}! Наш менеджер свяжется с вами по указанному телефону.`,
          CHANNEL_USERNAME ? `\nНаш канал: https://t.me/${CHANNEL_USERNAME}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        {
          reply_markup: webAppUrl
            ? Markup.keyboard([[Markup.button.webApp('✨🪦 ПОДОБРАТЬ ПАМЯТНИК 🪦✨', webAppUrl)]])
                .resize()
                .oneTime()
                .reply_markup
            : kbRemove().reply_markup,
        }
      );

      // ✅ показать фильтр в конце заказа
      if (typeof showFilterMenu === 'function') {
        await showFilterMenu(ctx);
      }
    } catch (e) {
      await ctx.reply('😔 Не удалось отправить заказ. Попробуйте позже.', kbRemove());
    } finally {
      ctx.session.order = null;
    }
  }

  async function cancelOrder(ctx, msg = 'Заказ отменён.') {
    ctx.session.order = null;
    return ctx.reply(`🛑 ${msg}`, kbRemove());
  }

  async function cancelEditReturnToReview(ctx) {
    const s = getOrder(ctx);
    s.step = 'review';
    return stepReview(ctx);
  }

  const isPostWizardActive = (ctx) => !!ctx.session?.postWizard;

  // ====== Редактирование ======
  bot.hears(['✏️ Изменить'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.step = 'edit_menu';
    await ctx.reply('Что хотите изменить?', kbEditMenu());
  });

  bot.hears('↩️ Отменить изменения', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    return cancelEditReturnToReview(ctx);
  });

  bot.hears('📝Имя', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'name';
    await renderStep(ctx);
  });

  bot.hears('📞Телефон', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'phone';
    await renderStep(ctx);
  });

  bot.hears('🕊ФИО', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'fio';
    await renderStep(ctx);
  });

  bot.hears('📅Даты', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'dates';
    await renderStep(ctx);
  });

  bot.hears('🖼Фото', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'photos';
    await renderStep(ctx);
  });

  bot.hears('💬Комментарий', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    const s = getOrder(ctx);
    s.editReturnStep = 'review';
    s.step = 'comment';
    await renderStep(ctx);
  });

  // ====== ОТМЕНА ЗАКАЗА ======
  bot.hears(['🛑 Отменить заказ'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (!ctx.session?.order) return next();
    return goConfirmCancel(ctx);
  });

  bot.hears(['Да, отменить'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (ctx.session?.order?.step === 'confirm_cancel') return cancelOrder(ctx, 'Заказ отменён.');
    return next();
  });

  bot.hears(['Нет, вернуться'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (ctx.session?.order?.step === 'confirm_cancel') {
      const s = getOrder(ctx);
      const backStep = s._beforeCancelStep || 'review';
      delete s._beforeCancelStep;
      s.step = backStep;
      return renderStep(ctx);
    }
    return next();
  });

  // ====== Навигация по шагам ======
  bot.hears(['➡️ Далее', 'Далее'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (ctx.session?.order?.step === 'photos') {
      ctx.session.order.step = 'comment';
      return renderStep(ctx);
    }
    return next();
  });

  bot.hears(['✅ Продолжить', 'Продолжить'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (ctx.session?.order?.step === 'comment') return stepReview(ctx);
    return next();
  });

  bot.hears(['📨 Отправить', 'Отправить'], async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();
    if (ctx.session?.order?.step === 'review') return submitOrder(ctx);
    return next();
  });

  // ====== START ======
  bot.start(async (ctx) => {
    ctx.session.order = null;

    const arg = (ctx.message?.text || '').split(' ').slice(1).join(' ').trim();
    const prefix = `${DEEPLINK_PREFIX}_`;

    // /start без параметров -> фильтр
    if (!arg) {
      if (typeof showFilterMenu === 'function') return showFilterMenu(ctx);
      await ctx.reply(HINT_TEXT);
      return startOrder(ctx, undefined);
    }

    let sourceToken = null;
    if (arg.startsWith(prefix)) sourceToken = arg.slice(prefix.length);

    await ctx.reply(HINT_TEXT);
    await startOrder(ctx, sourceToken || undefined);
  });

  bot.command('cancel', async (ctx) => {
    if (!ctx.session?.order) return ctx.reply('Нет активного заказа.', kbRemove());
    return goConfirmCancel(ctx);
  });

  // ====== Приём сообщений (ввод) ======
  bot.on('message', async (ctx, next) => {
    if (isPostWizardActive(ctx)) return next();

    const s = getOrder(ctx);
    const st = s.step;
    if (!st) return next();

    if ('text' in ctx.message && typeof ctx.message.text === 'string') {
      const t = ctx.message.text.trim();
      if (t.startsWith('/')) return next();
    }

    if (st === 'phone' && 'contact' in ctx.message && ctx.message.contact?.phone_number) {
      const num = ctx.message.contact.phone_number;
      s.tg_phone = num;
      s.phone = num;
      s.step = 'fio';
      await renderStep(ctx);
      return;
    }

    if ('text' in ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();

      if (st === 'name') {
        s.name = text;
        s.step = 'phone';
        await renderStep(ctx);
        return;
      }
      if (st === 'phone') {
        if (!phoneOk(text)) {
          return ctx.reply(
            '⚠️ Введите корректный номер телефона (минимум 6 цифр, можно с +)\nили нажмите «📱» для автоматической отправки.' +
              warningNote(),
            { parse_mode: 'HTML', ...kbPhone() }
          );
        }
        s.phone = text;
        s.step = 'fio';
        await renderStep(ctx);
        return;
      }
      if (st === 'fio') {
        s.fio = text;
        s.step = 'dates';
        await renderStep(ctx);
        return;
      }
      if (st === 'dates') {
        s.dates = text;
        s.step = 'photos';
        await renderStep(ctx);
        return;
      }
      if (st === 'comment') {
        if (!['✅ Продолжить', 'Продолжить', '🛑 Отменить заказ'].includes(text)) {
          s.comment = text;
          await ctx.reply(
            '✍️ Комментарий сохранён.\nЕсли готовы перейти к итоговому просмотру заказа — нажмите «✅ Продолжить».' + warningNote(),
            { parse_mode: 'HTML', ...kbComment() }
          );
          return;
        }
      }
    }

    if ('photo' in ctx.message && ctx.message.photo?.length) {
      if (st === 'photos') {
        const fileId = ctx.message.photo.at(-1)?.file_id;
        if (fileId) {
          s.photos = s.photos || [];
          s.photos.push(fileId);
          await ctx.reply('✅ Фото загружено.\nМожно отправить ещё фото или нажать «➡️ Далее».' + warningNote(), {
            parse_mode: 'HTML',
            ...kbPhotos(),
          });
          return;
        }
      }
    }

    return next();
  });
}