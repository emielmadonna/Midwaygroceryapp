import crypto from 'node:crypto';

import {
  createBookingHold,
  getAvailableSites,
  isActiveHold,
  quoteBooking,
  quoteMultiSiteBooking,
  toPublicSite,
} from './rv-booking.js';

const BLOCKING_BOOKING_STATUSES = ['hold', 'paid', 'confirmed', 'blocked'];

export function createBookingStore({ supabase = null, sites = [], bookings = [], holds = [], providerConnections = [], now, env = process.env } = {}) {
  if (supabase) return createSupabaseBookingStore({ supabase, now, env });
  return createMemoryBookingStore({ sites, bookings, holds, providerConnections, now });
}

export function createMemoryBookingStore({
  sites = [],
  bookings = [],
  holds = [],
  providerConnections = [],
  storeInventory = [],
  now = () => new Date(),
} = {}) {
  const state = {
    sites: sites.map(clone),
    bookings: bookings.map(clone),
    holds: holds.map(clone),
    storeInventory: storeInventory.map(normalizeInventoryRecord).filter(Boolean),
    squareEvents: [],
    auditLogs: [],
    notifications: [],
    documents: [],
    providerConnections: providerConnections.map(clone),
  };

  return {
    state,
    async listSites({ publicOnly = false } = {}) {
      const orderedSites = [...state.sites].sort(compareSites);
      return orderedSites.map(site => publicOnly ? toPublicSite(site) : clone(site));
    },
    async listAvailability({ startDate, endDate, publicOnly = false, now: nowOverride } = {}) {
      const checkedAt = resolveNow(nowOverride, now);
      expireMemoryRecords(state, checkedAt);

      return getAvailableSites({
        sites: state.sites,
        bookings: state.bookings,
        holds: state.holds,
        startDate,
        endDate,
        now: checkedAt,
      }).map(site => publicOnly ? toPublicSite(site) : clone(site));
    },
    async createHold(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      expireMemoryRecords(state, checkedAt);

      const hold = createBookingHold({
        sites: state.sites,
        bookings: state.bookings,
        holds: state.holds,
        ...input,
        now: checkedAt,
      });
      state.holds.push(hold);
      return clone(hold);
    },
    async createPendingBooking(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      expireMemoryRecords(state, checkedAt);

      const hold = findMemoryHold(state, input);
      assertHoldCanConvert({ state, hold, now: checkedAt });

      const site = state.sites.find(candidate => candidate.id === hold.rvSiteId);
      const quote = hold.quote ?? quoteBooking({
        site,
        startDate: hold.startDate,
        endDate: hold.endDate,
        guests: input.guests,
        vehicles: input.vehicles,
      });
      const customer = input.customer ?? {};
      const createdAt = checkedAt.toISOString();
      const booking = {
        id: crypto.randomUUID(),
        bookingCode: input.bookingCode ?? createBookingCode(),
        rvSiteId: hold.rvSiteId,
        rvSiteIds: hold.rvSiteIds ?? hold.siteIds ?? quote.siteIds ?? [hold.rvSiteId],
        siteIds: hold.rvSiteIds ?? hold.siteIds ?? quote.siteIds ?? [hold.rvSiteId],
        siteLines: quote.sites ?? [],
        holdId: hold.id,
        customer,
        customerName: customerName(customer),
        customerPhone: customer.phone ?? '',
        customerEmail: customer.email ?? null,
        startDate: hold.startDate,
        endDate: hold.endDate,
        nights: quote.nights,
        guests: quote.guests,
        vehicles: quote.vehicles,
        subtotalCents: quote.subtotalCents,
        taxCents: quote.taxCents,
        feeCents: quote.feeCents,
        totalCents: quote.totalCents,
        currency: quote.currency,
        status: 'hold',
        squareOrderId: input.squareOrderId ?? null,
        squarePaymentId: input.squarePaymentId ?? null,
        checkoutUrl: input.checkoutUrl ?? null,
        expiresAt: hold.expiresAt,
        quote,
        driverLicenseStatus: 'not_uploaded',
        source: input.source ?? 'website',
        createdAt,
        updatedAt: createdAt,
      };

      state.bookings.push(booking);
      hold.status = 'converted';
      hold.convertedBookingId = booking.id;
      return clone(booking);
    },
    async recordDriverLicenseUpload({ bookingCode, fileName, contentType, sizeBytes } = {}) {
      const booking = state.bookings.find(candidate => candidate.bookingCode === bookingCode);
      if (!booking) return null;
      const uploadedAt = resolveNow(null, now).toISOString();
      const document = {
        id: crypto.randomUUID(),
        bookingId: booking.id,
        bookingCode,
        documentType: 'driver_license',
        fileName: fileName || 'driver-license',
        contentType: contentType || 'application/octet-stream',
        sizeBytes: Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : null,
        storagePath: `memory://${bookingCode}/driver-license`,
        status: 'uploaded',
        uploadedAt,
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
      };
      state.documents.push(document);
      booking.driverLicenseStatus = 'uploaded';
      booking.updatedAt = uploadedAt;
      return clone(document);
    },
    async getBooking(bookingCode) {
      const booking = state.bookings.find(candidate => candidate.bookingCode === bookingCode);
      return booking ? clone(booking) : null;
    },
    async listBookings({ from, to, status } = {}) {
      expireMemoryRecords(state, resolveNow(null, now));
      return state.bookings
        .filter(booking => !status || booking.status === status)
        .filter(booking => !from || booking.endDate >= from)
        .filter(booking => !to || booking.startDate <= to)
        .sort(compareBookings)
        .map(clone);
    },
    async createAdminBooking(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      expireMemoryRecords(state, checkedAt);

      const site = state.sites.find(candidate => candidate.id === input.siteId);
      if (!site || site.status !== 'active') throw new Error('That RV site is not available.');

      const available = getAvailableSites({
        sites: state.sites,
        bookings: state.bookings,
        holds: state.holds,
        startDate: input.startDate,
        endDate: input.endDate,
        now: checkedAt,
      });
      if (!available.some(candidate => candidate.id === site.id)) {
        throw new Error('That RV site is no longer available for the selected dates.');
      }

      const quote = quoteBooking({
        site,
        startDate: input.startDate,
        endDate: input.endDate,
        guests: input.guests,
        vehicles: input.vehicles,
      });
      const customer = input.customer ?? {};
      const createdAt = checkedAt.toISOString();
      const status = input.status === 'blocked' ? 'blocked' : 'confirmed';
      const booking = {
        id: crypto.randomUUID(),
        bookingCode: input.bookingCode ?? createBookingCode(),
        rvSiteId: site.id,
        holdId: null,
        customer,
        customerName: status === 'blocked' ? (customerName(customer) || 'Blocked') : customerName(customer),
        customerPhone: customer.phone ?? '',
        customerEmail: customer.email ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        nights: quote.nights,
        guests: quote.guests,
        vehicles: quote.vehicles,
        subtotalCents: status === 'blocked' ? 0 : quote.subtotalCents,
        taxCents: 0,
        feeCents: 0,
        totalCents: status === 'blocked' ? 0 : quote.totalCents,
        currency: quote.currency,
        status,
        squareOrderId: null,
        squarePaymentId: null,
        checkoutUrl: null,
        expiresAt: null,
        quote,
        source: input.source ?? 'admin',
        notes: input.notes ?? null,
        createdAt,
        updatedAt: createdAt,
      };

      state.bookings.push(booking);
      return clone(booking);
    },
    async confirmBooking({ bookingCode, squareOrderId, squarePaymentId, source = 'square' } = {}) {
      const booking = state.bookings.find(candidate => (
        candidate.bookingCode === bookingCode ||
        (squareOrderId && candidate.squareOrderId === squareOrderId)
      ));
      if (!booking) return null;
      if (booking.status === 'confirmed' && (!squarePaymentId || booking.squarePaymentId === squarePaymentId)) {
        return clone(booking);
      }

      const confirmedAt = new Date(resolveNow(null, now)).toISOString();
      booking.status = 'confirmed';
      booking.squareOrderId = squareOrderId || booking.squareOrderId;
      booking.squarePaymentId = squarePaymentId || booking.squarePaymentId;
      booking.confirmedAt = confirmedAt;
      booking.confirmedBy = source;
      booking.updatedAt = confirmedAt;

      return clone(booking);
    },
    async updateBookingStatus({ bookingCode, status, actor = null, refund = null } = {}) {
      const booking = state.bookings.find(candidate => candidate.bookingCode === bookingCode);
      if (!booking) return null;
      const updatedAt = resolveNow(null, now).toISOString();
      booking.status = status;
      if (status === 'refunded') {
        booking.squareRefundId = refund?.refundId ?? booking.squareRefundId ?? null;
        booking.refundAmountCents = refund?.amountCents ?? booking.totalCents;
        booking.refundReason = refund?.reason ?? null;
        booking.refundedAt = updatedAt;
        booking.refundedBy = actor?.id ?? null;
      }
      booking.updatedAt = updatedAt;
      booking.updatedBy = actor?.id ?? null;
      return clone(booking);
    },
    async refundBooking({ bookingCode, refund, actor = null } = {}) {
      const booking = state.bookings.find(candidate => candidate.bookingCode === bookingCode);
      if (!booking) return null;
      const refundedAt = resolveNow(null, now).toISOString();
      booking.status = 'refunded';
      booking.squareRefundId = refund?.refundId ?? booking.squareRefundId ?? null;
      booking.refundAmountCents = refund?.amountCents ?? booking.totalCents;
      booking.refundReason = refund?.reason ?? null;
      booking.refundedAt = refundedAt;
      booking.refundedBy = actor?.id ?? null;
      booking.updatedAt = refundedAt;
      booking.updatedBy = actor?.id ?? null;
      return clone(booking);
    },
    async updateSiteStatus({ siteId, status, actor = null } = {}) {
      return this.updateSiteDetails({ siteId, patch: { status }, actor });
    },
    async updateSiteDetails({ siteId, patch = {}, actor = null } = {}) {
      const site = state.sites.find(candidate => candidate.id === siteId);
      if (!site) return null;
      const update = normalizeSitePatch(patch);
      Object.assign(site, update);
      site.updatedAt = resolveNow(null, now).toISOString();
      site.updatedBy = actor?.id ?? null;
      return clone(site);
    },
    async listStoreInventory({ activeOnly = false } = {}) {
      return state.storeInventory
        .filter(item => !activeOnly || (item.active && !item.hidden))
        .sort(compareInventoryItems)
        .map(clone);
    },
    async upsertStoreInventory(items = []) {
      const normalized = items.map(normalizeInventoryRecord).filter(Boolean);
      const updated = [];
      for (const item of normalized) {
        const existing = state.storeInventory.find(candidate => (
          candidate.squareVariationId === item.squareVariationId
          || candidate.squareId === item.squareId
        ));
        if (existing) {
          Object.assign(existing, item, {
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: item.updatedAt || resolveNow(null, now).toISOString(),
          });
          updated.push(clone(existing));
        } else {
          const record = {
            ...item,
            id: crypto.randomUUID(),
            createdAt: resolveNow(null, now).toISOString(),
            updatedAt: item.updatedAt || resolveNow(null, now).toISOString(),
          };
          state.storeInventory.push(record);
          updated.push(clone(record));
        }
      }
      return updated.sort(compareInventoryItems);
    },
    async findStoreInventoryByVariationId(variationId) {
      if (!variationId) return null;
      const item = state.storeInventory.find(candidate => candidate.squareVariationId === variationId);
      return item ? clone(item) : null;
    },
    async recordSquareEvent({ event = {}, payload = {} } = {}) {
      const squareEventId = event.eventId ?? null;
      const existing = squareEventId
        ? state.squareEvents.find(candidate => candidate.squareEventId === squareEventId)
        : null;
      if (existing) {
        return { duplicate: true, event: clone(existing) };
      }

      const createdAt = resolveNow(null, now).toISOString();
      const record = {
        id: crypto.randomUUID(),
        squareEventId,
        eventType: event.type || 'unknown',
        bookingCode: event.bookingCode ?? null,
        squareOrderId: event.squareOrderId ?? null,
        squarePaymentId: event.squarePaymentId ?? null,
        rawPayload: clone(payload),
        processingStatus: 'received',
        processedAt: null,
        errorMessage: null,
        createdAt,
      };
      state.squareEvents.push(record);
      return { duplicate: false, event: clone(record) };
    },
    async markSquareEvent({ eventId, status = 'processed', errorMessage = null, booking = null } = {}) {
      if (!eventId) return null;
      const record = state.squareEvents.find(candidate => candidate.squareEventId === eventId);
      if (!record) return null;

      record.processingStatus = status;
      record.errorMessage = errorMessage;
      record.bookingCode = booking?.bookingCode ?? record.bookingCode;
      record.squareOrderId = booking?.squareOrderId ?? record.squareOrderId;
      record.squarePaymentId = booking?.squarePaymentId ?? record.squarePaymentId;
      record.processedAt = resolveNow(null, now).toISOString();
      return clone(record);
    },
    async releaseHold(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      const hold = findMemoryHold(state, input);
      assertSessionMatches(hold, input.customerSessionId);

      if (!['active', 'converted'].includes(hold.status)) return clone(hold);
      hold.status = 'released';

      const booking = state.bookings.find(candidate => candidate.id === hold.convertedBookingId);
      if (booking?.status === 'hold') {
        booking.status = 'expired';
        booking.updatedAt = checkedAt.toISOString();
      }
      return clone(hold);
    },
    async expireHolds({ now: nowOverride } = {}) {
      return expireMemoryRecords(state, resolveNow(nowOverride, now));
    },
    async recordAuditLog(input = {}) {
      const record = {
        id: crypto.randomUUID(),
        action: input.action,
        actorId: input.actor?.id ?? input.actorId ?? 'system',
        actorRole: input.actor?.role ?? input.actorRole ?? 'system',
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: clone(input.metadata ?? {}),
        createdAt: resolveNow(null, now).toISOString(),
      };
      state.auditLogs.push(record);
      return clone(record);
    },
    async listAuditLogs({ limit = 50 } = {}) {
      return [...state.auditLogs].reverse().slice(0, limit).map(clone);
    },
    async recordNotification(input = {}) {
      const record = {
        id: crypto.randomUUID(),
        type: input.type,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        bookingCode: input.bookingCode ?? null,
        status: input.status ?? 'queued',
        errorMessage: input.errorMessage ?? null,
        createdAt: resolveNow(null, now).toISOString(),
      };
      state.notifications.push(record);
      return clone(record);
    },
    async listNotifications({ limit = 50 } = {}) {
      return [...state.notifications].reverse().slice(0, limit).map(clone);
    },
    async listProviderConnections({ tenantId = 'midway', locationId = 'plain' } = {}) {
      return state.providerConnections
        .filter(connection => connection.tenantId === tenantId)
        .filter(connection => (connection.locationId ?? null) === (locationId ?? null))
        .sort(compareProviderConnections)
        .map(clone);
    },
    async getProviderConnection({ tenantId = 'midway', locationId = 'plain', providerKey } = {}) {
      const connection = state.providerConnections.find(candidate => (
        candidate.tenantId === tenantId
        && (candidate.locationId ?? null) === (locationId ?? null)
        && candidate.providerKey === providerKey
      ));
      return connection ? clone(connection) : null;
    },
    async upsertProviderConnection(input = {}) {
      const existing = state.providerConnections.find(candidate => (
        candidate.tenantId === input.tenantId
        && (candidate.locationId ?? null) === (input.locationId ?? null)
        && candidate.providerKey === input.providerKey
      ));
      const updatedAt = resolveNow(null, now).toISOString();
      if (existing) {
        Object.assign(existing, {
          ...clone(input),
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt,
        });
        return clone(existing);
      }

      const record = {
        id: crypto.randomUUID(),
        tenantId: input.tenantId ?? 'midway',
        locationId: input.locationId ?? 'plain',
        providerKey: input.providerKey,
        providerKind: input.providerKind,
        status: input.status ?? 'not_connected',
        publicConfig: clone(input.publicConfig ?? {}),
        secretRef: input.secretRef ?? null,
        encryptedCredentials: clone(input.encryptedCredentials ?? {}),
        scopes: clone(input.scopes ?? []),
        externalAccountId: input.externalAccountId ?? null,
        externalLocationId: input.externalLocationId ?? null,
        lastSyncAt: input.lastSyncAt ?? null,
        errorMessage: input.errorMessage ?? null,
        updatedBy: input.updatedBy ?? null,
        createdAt: updatedAt,
        updatedAt,
      };
      state.providerConnections.push(record);
      return clone(record);
    },
  };
}

export function createSupabaseBookingStore({ supabase, now = () => new Date(), env = process.env } = {}) {
  if (!supabase) throw new Error('Supabase client is required.');

  return {
    async listSites({ publicOnly = false } = {}) {
      const sites = await loadSupabaseSites(supabase);
      return sites.map(site => publicOnly ? toPublicSite(site) : site);
    },
    async listAvailability({ startDate, endDate, publicOnly = false, now: nowOverride } = {}) {
      const checkedAt = resolveNow(nowOverride, now);
      await expireSupabaseRecords(supabase, checkedAt);

      const [sites, bookings, holds] = await Promise.all([
        loadSupabaseSites(supabase),
        loadSupabaseBlockingBookings(supabase, { startDate, endDate }),
        loadSupabaseActiveHolds(supabase, { startDate, endDate, now: checkedAt }),
      ]);

      return getAvailableSites({
        sites,
        bookings,
        holds,
        startDate,
        endDate,
        now: checkedAt,
      }).map(site => publicOnly ? toPublicSite(site) : site);
    },
    async createHold(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      await expireSupabaseRecords(supabase, checkedAt);

      const [sites, bookings, holds] = await Promise.all([
        loadSupabaseSites(supabase),
        loadSupabaseBlockingBookings(supabase, input),
        loadSupabaseActiveHolds(supabase, { ...input, now: checkedAt }),
      ]);

      const hold = createBookingHold({
        sites,
        bookings,
        holds,
        ...input,
        now: checkedAt,
      });
      const { data, error } = await supabase
        .from('rv_booking_holds')
        .insert(toSupabaseHoldInsert(hold))
        .select('*')
        .single();

      if (error) throw availabilityError(error);
      return { ...fromSupabaseHold(data), quote: hold.quote };
    },
    async createPendingBooking(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      await expireSupabaseRecords(supabase, checkedAt);

      const hold = await loadSupabaseHold(supabase, input.holdId ?? input.hold?.id);
      assertActiveHold(hold, checkedAt);

      const [sites, bookings, holds] = await Promise.all([
        loadSupabaseSites(supabase),
        loadSupabaseBlockingBookings(supabase, hold),
        loadSupabaseActiveHolds(supabase, { ...hold, now: checkedAt }),
      ]);

      const state = { sites, bookings, holds: holds.filter(candidate => candidate.id !== hold.id) };
      assertHoldCanConvert({ state, hold, now: checkedAt });

      const site = sites.find(candidate => candidate.id === hold.rvSiteId);
      const quote = input.hold?.quote ?? hold.quote ?? quoteBooking({
        site,
        startDate: hold.startDate,
        endDate: hold.endDate,
        guests: input.guests,
        vehicles: input.vehicles,
      });
      const bookingRow = toSupabaseBookingInsert({
        input,
        hold,
        quote,
        now: checkedAt,
      });
      const { data: bookingData, error: bookingError } = await supabase
        .from('rv_bookings')
        .insert(bookingRow)
        .select('*')
        .single();

      if (bookingError) throw availabilityError(bookingError);

      const { error: holdError } = await supabase
        .from('rv_booking_holds')
        .update({ status: 'converted', converted_booking_id: bookingData.id })
        .eq('id', hold.id)
        .eq('status', 'active')
        .select('*')
        .single();

      if (holdError) {
        await supabase.from('rv_bookings').update({ status: 'expired' }).eq('id', bookingData.id);
        throw holdError;
      }

      return {
        ...fromSupabaseBooking(bookingData),
        holdId: hold.id,
        customer: input.customer ?? {},
        checkoutUrl: input.checkoutUrl ?? null,
        expiresAt: hold.expiresAt,
        quote,
      };
    },
    async getBooking(bookingCode) {
      const { data, error } = await supabase
        .from('rv_bookings')
        .select('*')
        .eq('booking_code', bookingCode)
        .maybeSingle();
      if (error) throw error;
      return data ? fromSupabaseBooking(data) : null;
    },
    async recordDriverLicenseUpload({
      bookingCode,
      fileName,
      contentType,
      buffer,
      sizeBytes,
    } = {}) {
      if (!bookingCode) throw new Error('Booking code is required.');
      if (!buffer || !buffer.length) throw new Error('Driver license image is required.');

      const { data: booking, error: bookingError } = await supabase
        .from('rv_bookings')
        .select('*')
        .eq('booking_code', bookingCode)
        .maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking) return null;

      const uploadedAt = resolveNow(null, now).toISOString();
      const storagePath = `${bookingCode}/${crypto.randomUUID()}-${safeDocumentFileName(fileName, contentType)}`;
      const bucket = bookingDocumentsBucket(env);
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, buffer, {
          contentType: contentType || 'application/octet-stream',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const row = {
        booking_id: booking.id,
        booking_code: bookingCode,
        document_type: 'driver_license',
        file_name: fileName || 'driver-license',
        content_type: contentType || 'application/octet-stream',
        size_bytes: Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : buffer.length,
        storage_bucket: bucket,
        storage_path: storagePath,
        status: 'uploaded',
        uploaded_at: uploadedAt,
        updated_at: uploadedAt,
      };
      const { data: document, error: documentError } = await supabase
        .from('booking_documents')
        .insert(row)
        .select('*')
        .single();
      if (documentError) throw documentError;

      await supabase
        .from('rv_bookings')
        .update({ driver_license_status: 'uploaded', updated_at: uploadedAt })
        .eq('id', booking.id);

      return fromSupabaseBookingDocument(document);
    },
    async listBookings({ from, to, status } = {}) {
      await expireSupabaseRecords(supabase, resolveNow(null, now));

      let query = supabase
        .from('rv_bookings')
        .select('*')
        .order('start_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (status) query = query.eq('status', status);
      if (from) query = query.gte('end_date', from);
      if (to) query = query.lte('start_date', to);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(fromSupabaseBooking);
    },
    async createAdminBooking(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      await expireSupabaseRecords(supabase, checkedAt);

      const [sites, bookings, holds] = await Promise.all([
        loadSupabaseSites(supabase),
        loadSupabaseBlockingBookings(supabase, input),
        loadSupabaseActiveHolds(supabase, { ...input, now: checkedAt }),
      ]);

      const site = sites.find(candidate => candidate.id === input.siteId);
      if (!site || site.status !== 'active') throw new Error('That RV site is not available.');

      const available = getAvailableSites({
        sites,
        bookings,
        holds,
        startDate: input.startDate,
        endDate: input.endDate,
        now: checkedAt,
      });
      if (!available.some(candidate => candidate.id === site.id)) {
        throw new Error('That RV site is no longer available for the selected dates.');
      }

      const quote = quoteBooking({
        site,
        startDate: input.startDate,
        endDate: input.endDate,
        guests: input.guests,
        vehicles: input.vehicles,
      });
      const row = toSupabaseAdminBookingInsert({ input, site, quote, now: checkedAt });
      const { data, error } = await supabase
        .from('rv_bookings')
        .insert(row)
        .select('*')
        .single();
      if (error) throw availabilityError(error);
      return fromSupabaseBooking(data);
    },
    async confirmBooking({ bookingCode, squareOrderId, squarePaymentId, source = 'square' } = {}) {
      let query = supabase.from('rv_bookings').select('*');
      if (bookingCode) {
        query = query.eq('booking_code', bookingCode);
      } else if (squareOrderId) {
        query = query.eq('square_order_id', squareOrderId);
      } else {
        throw new Error('Booking code or Square order id is required.');
      }

      const { data: existing, error: findError } = await query.maybeSingle();
      if (findError) throw findError;
      if (!existing) return null;
      if (existing.status === 'confirmed' && (!squarePaymentId || existing.square_payment_id === squarePaymentId)) {
        return fromSupabaseBooking(existing);
      }

      const isoNow = resolveNow(null, now).toISOString();
      const { data, error } = await supabase
        .from('rv_bookings')
        .update({
          status: 'confirmed',
          square_order_id: squareOrderId || existing.square_order_id,
          square_payment_id: squarePaymentId || existing.square_payment_id,
          confirmed_at: isoNow,
          confirmed_by: source,
          updated_at: isoNow,
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;

      return {
        ...fromSupabaseBooking(data),
        confirmedAt: isoNow,
        confirmedBy: source,
      };
    },
    async updateBookingStatus({ bookingCode, status, actor = null, refund = null } = {}) {
      const update = {
        status,
        updated_at: resolveNow(null, now).toISOString(),
      };
      if (status === 'refunded') {
        update.square_refund_id = refund?.refundId ?? null;
        update.refund_amount_cents = refund?.amountCents ?? null;
        update.refund_reason = refund?.reason ?? null;
        update.refunded_at = update.updated_at;
        update.refunded_by = actor?.id ?? null;
      }
      const { data, error } = await supabase
        .from('rv_bookings')
        .update(update)
        .eq('booking_code', bookingCode)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? fromSupabaseBooking(data) : null;
    },
    async refundBooking({ bookingCode, refund, actor = null } = {}) {
      const isoNow = resolveNow(null, now).toISOString();
      const { data, error } = await supabase
        .from('rv_bookings')
        .update({
          status: 'refunded',
          square_refund_id: refund?.refundId ?? null,
          refund_amount_cents: refund?.amountCents ?? null,
          refund_reason: refund?.reason ?? null,
          refunded_at: isoNow,
          refunded_by: actor?.id ?? null,
          updated_at: isoNow,
        })
        .eq('booking_code', bookingCode)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? fromSupabaseBooking(data) : null;
    },
    async updateSiteStatus({ siteId, status, actor = null } = {}) {
      return this.updateSiteDetails({ siteId, patch: { status }, actor });
    },
    async updateSiteDetails({ siteId, patch = {} } = {}) {
      const update = toSupabaseSiteUpdate(normalizeSitePatch(patch), resolveNow(null, now));
      const amenities = 'amenities' in patch ? normalizeAmenities(patch.amenities) : null;
      const shouldUpdateRow = Object.keys(update).length > 1;

      let data = null;
      if (shouldUpdateRow) {
        const response = await supabase
          .from('rv_sites')
          .update(update)
          .eq('id', siteId)
          .select('*')
          .maybeSingle();
        if (response.error) throw response.error;
        data = response.data;
      } else {
        const response = await supabase
          .from('rv_sites')
          .select('*')
          .eq('id', siteId)
          .maybeSingle();
        if (response.error) throw response.error;
        data = response.data;
      }
      if (!data) return null;

      if (amenities) {
        const { error: deleteError } = await supabase
          .from('rv_site_amenities')
          .delete()
          .eq('rv_site_id', siteId);
        if (deleteError) throw deleteError;

        if (amenities.length > 0) {
          const { error: insertError } = await supabase
            .from('rv_site_amenities')
            .insert(amenities.map(label => ({
              rv_site_id: siteId,
              amenity_key: amenityKey(label),
              amenity_label: label,
            })));
          if (insertError) throw insertError;
        }
      }

      let resolvedAmenities = amenities;
      if (!resolvedAmenities) {
        const { data: amenityRows, error: amenityError } = await supabase
          .from('rv_site_amenities')
          .select('*')
          .eq('rv_site_id', siteId);
        if (amenityError) throw amenityError;
        resolvedAmenities = (amenityRows ?? []).map(row => row.amenity_label || row.amenity_key);
      }

      return fromSupabaseSite(data, resolvedAmenities);
    },
    async listStoreInventory({ activeOnly = false } = {}) {
      let query = supabase
        .from('store_inventory')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (activeOnly) query = query.eq('active', true).eq('hidden', false);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(fromSupabaseInventory);
    },
    async upsertStoreInventory(items = []) {
      const rows = items.map(item => toSupabaseInventoryUpsert(item, resolveNow(null, now))).filter(Boolean);
      if (rows.length === 0) return [];
      const { data, error } = await supabase
        .from('store_inventory')
        .upsert(rows, { onConflict: 'square_variation_id' })
        .select('*');
      if (error) throw error;
      return (data ?? []).map(fromSupabaseInventory).sort(compareInventoryItems);
    },
    async findStoreInventoryByVariationId(variationId) {
      if (!variationId) return null;
      const { data, error } = await supabase
        .from('store_inventory')
        .select('*')
        .eq('square_variation_id', variationId)
        .maybeSingle();
      if (error) throw error;
      return data ? fromSupabaseInventory(data) : null;
    },
    async recordSquareEvent({ event = {}, payload = {} } = {}) {
      const squareEventId = event.eventId ?? null;
      const insert = {
        square_event_id: squareEventId,
        event_type: event.type || 'unknown',
        booking_code: event.bookingCode ?? null,
        square_order_id: event.squareOrderId ?? null,
        square_payment_id: event.squarePaymentId ?? null,
        raw_payload: payload,
        processing_status: 'received',
      };

      const { data, error } = await supabase
        .from('square_events')
        .insert(insert)
        .select('*')
        .single();

      if (!error) return { duplicate: false, event: fromSupabaseSquareEvent(data) };
      if (error.code !== '23505' || !squareEventId) throw error;

      const { data: existing, error: existingError } = await supabase
        .from('square_events')
        .select('*')
        .eq('square_event_id', squareEventId)
        .single();
      if (existingError) throw existingError;
      return { duplicate: true, event: fromSupabaseSquareEvent(existing) };
    },
    async markSquareEvent({ eventId, status = 'processed', errorMessage = null, booking = null } = {}) {
      if (!eventId) return null;
      const update = {
        processing_status: status,
        error_message: errorMessage,
        processed_at: resolveNow(null, now).toISOString(),
      };
      if (booking?.bookingCode) update.booking_code = booking.bookingCode;
      if (booking?.squareOrderId) update.square_order_id = booking.squareOrderId;
      if (booking?.squarePaymentId) update.square_payment_id = booking.squarePaymentId;

      const { data, error } = await supabase
        .from('square_events')
        .update(update)
        .eq('square_event_id', eventId)
        .select('*')
        .single();
      if (error) throw error;
      return fromSupabaseSquareEvent(data);
    },
    async releaseHold(input = {}) {
      const checkedAt = resolveNow(input.now, now);
      const hold = await loadSupabaseHold(supabase, input.holdId ?? input.id);
      assertSessionMatches(hold, input.customerSessionId);

      if (!['active', 'converted'].includes(hold.status)) return hold;

      const { data, error } = await supabase
        .from('rv_booking_holds')
        .update({ status: 'released' })
        .eq('id', hold.id)
        .select('*')
        .single();
      if (error) throw error;

      if (hold.convertedBookingId) {
        await supabase
          .from('rv_bookings')
          .update({ status: 'expired', updated_at: checkedAt.toISOString() })
          .eq('id', hold.convertedBookingId)
          .eq('status', 'hold');
      }
      return fromSupabaseHold(data);
    },
    async expireHolds({ now: nowOverride } = {}) {
      return expireSupabaseRecords(supabase, resolveNow(nowOverride, now));
    },
    async recordAuditLog(input = {}) {
      const insert = {
        action: input.action,
        actor_id: input.actor?.id ?? input.actorId ?? 'system',
        actor_role: input.actor?.role ?? input.actorRole ?? 'system',
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        metadata: input.metadata ?? {},
      };
      const { data, error } = await supabase
        .from('admin_audit_log')
        .insert(insert)
        .select('*')
        .single();
      if (error) throw error;
      return fromSupabaseAuditLog(data);
    },
    async listAuditLogs({ limit = 50 } = {}) {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map(fromSupabaseAuditLog);
    },
    async recordNotification(input = {}) {
      const insert = {
        notification_type: input.type,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        booking_code: input.bookingCode ?? null,
        status: input.status ?? 'queued',
        error_message: input.errorMessage ?? null,
      };
      const { data, error } = await supabase
        .from('notifications')
        .insert(insert)
        .select('*')
        .single();
      if (error) throw error;
      return fromSupabaseNotification(data);
    },
    async listNotifications({ limit = 50 } = {}) {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map(fromSupabaseNotification);
    },
    async listProviderConnections({ tenantId = 'midway', locationId = 'plain' } = {}) {
      const { data, error } = await supabase
        .from('provider_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .order('provider_kind', { ascending: true })
        .order('provider_key', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(fromSupabaseProviderConnection);
    },
    async getProviderConnection({ tenantId = 'midway', locationId = 'plain', providerKey } = {}) {
      const { data, error } = await supabase
        .from('provider_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .eq('provider_key', providerKey)
        .maybeSingle();
      if (error) throw error;
      return data ? fromSupabaseProviderConnection(data) : null;
    },
    async upsertProviderConnection(input = {}) {
      const row = toSupabaseProviderConnectionUpsert(input, resolveNow(null, now));
      const { data, error } = await supabase
        .from('provider_connections')
        .upsert(row, { onConflict: 'tenant_id,location_id,provider_key' })
        .select('*')
        .single();
      if (error) throw error;
      return fromSupabaseProviderConnection(data);
    },
  };
}

function expireMemoryRecords(state, now) {
  const expiredHolds = [];
  const expiredBookings = [];

  for (const hold of state.holds) {
    if (hold.status === 'active' && !isActiveHold(hold, now)) {
      hold.status = 'expired';
      expiredHolds.push(clone(hold));
    }

    if (hold.status === 'converted' && new Date(hold.expiresAt) <= now) {
      hold.status = 'expired';
      expiredHolds.push(clone(hold));
      const booking = state.bookings.find(candidate => candidate.id === hold.convertedBookingId);
      if (booking?.status === 'hold') {
        booking.status = 'expired';
        booking.updatedAt = now.toISOString();
        expiredBookings.push(clone(booking));
      }
    }
  }

  return { holds: expiredHolds, bookings: expiredBookings };
}

async function expireSupabaseRecords(supabase, now) {
  const isoNow = now.toISOString();
  const { data: activeHolds, error: activeHoldError } = await supabase
    .from('rv_booking_holds')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lte('expires_at', isoNow)
    .select('*');
  if (activeHoldError) throw activeHoldError;

  const { data: convertedHolds, error: convertedHoldError } = await supabase
    .from('rv_booking_holds')
    .select('*')
    .eq('status', 'converted')
    .lte('expires_at', isoNow)
    .not('converted_booking_id', 'is', null);
  if (convertedHoldError) throw convertedHoldError;

  const bookingIds = (convertedHolds ?? []).map(hold => hold.converted_booking_id);
  let expiredBookings = [];
  if (bookingIds.length > 0) {
    const { data, error } = await supabase
      .from('rv_bookings')
      .update({ status: 'expired', updated_at: isoNow })
      .eq('status', 'hold')
      .in('id', bookingIds)
      .select('*');
    if (error) throw error;
    expiredBookings = data ?? [];

    const { error: holdError } = await supabase
      .from('rv_booking_holds')
      .update({ status: 'expired' })
      .in('id', convertedHolds.map(hold => hold.id));
    if (holdError) throw holdError;
  }

  return {
    holds: [...(activeHolds ?? []), ...(convertedHolds ?? [])].map(fromSupabaseHold),
    bookings: expiredBookings.map(fromSupabaseBooking),
  };
}

async function loadSupabaseSites(supabase) {
  const { data: siteRows, error } = await supabase
    .from('rv_sites')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('site_number', { ascending: true });
  if (error) throw error;
  if (!siteRows?.length) return [];

  const { data: amenities, error: amenitiesError } = await supabase
    .from('rv_site_amenities')
    .select('*')
    .in('rv_site_id', siteRows.map(site => site.id));
  if (amenitiesError) throw amenitiesError;

  const amenitiesBySite = new Map();
  for (const amenity of amenities ?? []) {
    const list = amenitiesBySite.get(amenity.rv_site_id) ?? [];
    list.push(amenity.amenity_label || amenity.amenity_key);
    amenitiesBySite.set(amenity.rv_site_id, list);
  }

  return siteRows.map(row => fromSupabaseSite(row, amenitiesBySite.get(row.id) ?? []));
}

async function loadSupabaseBlockingBookings(supabase, { startDate, endDate }) {
  const { data, error } = await supabase
    .from('rv_bookings')
    .select('*')
    .in('status', BLOCKING_BOOKING_STATUSES)
    .lt('start_date', endDate)
    .gt('end_date', startDate);
  if (error) throw error;
  return (data ?? []).map(fromSupabaseBooking);
}

async function loadSupabaseActiveHolds(supabase, { startDate, endDate, now }) {
  const { data, error } = await supabase
    .from('rv_booking_holds')
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .lt('start_date', endDate)
    .gt('end_date', startDate);
  if (error) throw error;
  return (data ?? []).map(fromSupabaseHold);
}

async function loadSupabaseHold(supabase, holdId) {
  if (!holdId) throw new Error('Hold id is required.');

  const { data, error } = await supabase
    .from('rv_booking_holds')
    .select('*')
    .eq('id', holdId)
    .single();
  if (error) throw error;
  return fromSupabaseHold(data);
}

function normalizeSitePatch(patch = {}) {
  const update = {};
  const stringFields = [
    'displayName',
    'status',
    'amp',
    'type',
    'shade',
    'sku',
    'squareCatalogObjectId',
    'shortDescription',
    'customerNotes',
    'adminNotes',
  ];
  const integerFields = [
    'nightlyPriceCents',
    'maxRvLengthFeet',
    'mapX',
    'mapY',
    'mapWidth',
    'mapHeight',
    'rotation',
    'sortOrder',
  ];

  for (const field of stringFields) {
    if (!(field in patch)) continue;
    const value = patch[field];
    update[field] = value === null ? null : String(value ?? '').trim();
  }
  if ('siteType' in patch && !('type' in patch)) {
    update.type = String(patch.siteType ?? '').trim();
  }
  for (const field of integerFields) {
    if (!(field in patch)) continue;
    const value = patch[field];
    update[field] = value === null || value === '' ? null : Number(value);
  }
  if ('amenities' in patch) update.amenities = normalizeAmenities(patch.amenities);

  if ('status' in update && !['active', 'inactive', 'maintenance'].includes(update.status)) {
    throw new Error('Site status must be active, inactive, or maintenance.');
  }
  if ('nightlyPriceCents' in update && (!Number.isInteger(update.nightlyPriceCents) || update.nightlyPriceCents < 0)) {
    throw new Error('Nightly price must be a non-negative whole-cent amount.');
  }
  for (const field of integerFields.filter(field => field !== 'nightlyPriceCents')) {
    if (field in update && update[field] !== null && !Number.isInteger(update[field])) {
      throw new Error(`${field} must be a whole number.`);
    }
  }
  if ('squareCatalogObjectId' in update && !update.squareCatalogObjectId) update.squareCatalogObjectId = null;
  if ('sku' in update && !update.sku) update.sku = null;
  return update;
}

function normalizeAmenities(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);
  return [...new Set(values
    .map(item => String(item || '').trim())
    .filter(Boolean))];
}

function amenityKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'amenity';
}

function assertHoldCanConvert({ state, hold, now }) {
  assertActiveHold(hold, now);

  const available = getAvailableSites({
    sites: state.sites,
    bookings: state.bookings,
    holds: state.holds.filter(candidate => candidate.id !== hold.id),
    startDate: hold.startDate,
    endDate: hold.endDate,
    now,
  });

  const availableIds = new Set(available.map(site => site.id));
  const holdSiteIds = hold.rvSiteIds ?? hold.siteIds ?? hold.quote?.siteIds ?? [hold.rvSiteId];
  if (!holdSiteIds.every(siteId => availableIds.has(siteId))) {
    throw new Error('That RV site is no longer available for the selected dates.');
  }
}

function assertActiveHold(hold, now) {
  if (!hold || hold.status !== 'active' || new Date(hold.expiresAt) <= now) {
    throw new Error('That booking hold is no longer active.');
  }
}

function assertSessionMatches(hold, customerSessionId) {
  if (customerSessionId && hold.customerSessionId !== customerSessionId) {
    throw new Error('That booking hold belongs to another session.');
  }
}

function findMemoryHold(state, input) {
  const holdId = input.holdId ?? input.id ?? input.hold?.id;
  const hold = state.holds.find(candidate => candidate.id === holdId);
  if (!hold) throw new Error('Booking hold was not found.');
  return hold;
}

function toSupabaseHoldInsert(hold) {
  return {
    id: hold.id,
    rv_site_id: hold.rvSiteId,
    rv_site_ids: hold.rvSiteIds ?? hold.siteIds ?? [hold.rvSiteId],
    start_date: hold.startDate,
    end_date: hold.endDate,
    customer_session_id: hold.customerSessionId,
    expires_at: hold.expiresAt,
    status: hold.status,
    quote_snapshot: hold.quote ?? null,
    created_at: hold.createdAt,
  };
}

function toSupabaseBookingInsert({ input, hold, quote, now }) {
  const customer = input.customer ?? {};
  return {
    id: crypto.randomUUID(),
    booking_code: input.bookingCode ?? createBookingCode(),
    rv_site_id: hold.rvSiteId,
    rv_site_ids: quote.siteIds ?? hold.rvSiteIds ?? hold.siteIds ?? [hold.rvSiteId],
    site_lines: quote.sites ?? [],
    hold_id: hold.id,
    customer_name: customerName(customer),
    customer_phone: customer.phone ?? '',
    customer_email: customer.email ?? null,
    start_date: hold.startDate,
    end_date: hold.endDate,
    nights: quote.nights,
    guests: quote.guests,
    vehicles: quote.vehicles,
    subtotal_cents: quote.subtotalCents,
    tax_cents: quote.taxCents,
    fee_cents: quote.feeCents,
    total_cents: quote.totalCents,
    currency: quote.currency,
    status: 'hold',
    square_order_id: input.squareOrderId ?? null,
    square_payment_id: input.squarePaymentId ?? null,
    square_catalog_object_id: quote.squareCatalogObjectId ?? null,
    sku: quote.sku ?? null,
    checkout_url: input.checkoutUrl ?? null,
    expires_at: hold.expiresAt ?? null,
    driver_license_status: 'not_uploaded',
    source: input.source ?? 'website',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function toSupabaseAdminBookingInsert({ input, site, quote, now }) {
  const customer = input.customer ?? {};
  const status = input.status === 'blocked' ? 'blocked' : 'confirmed';
  const isBlocked = status === 'blocked';

  return {
    id: crypto.randomUUID(),
    booking_code: input.bookingCode ?? createBookingCode(),
    rv_site_id: site.id,
    customer_name: isBlocked ? (customerName(customer) || 'Blocked') : customerName(customer),
    customer_phone: customer.phone ?? '',
    customer_email: customer.email ?? null,
    start_date: input.startDate,
    end_date: input.endDate,
    nights: quote.nights,
    guests: quote.guests,
    vehicles: quote.vehicles,
    subtotal_cents: isBlocked ? 0 : quote.subtotalCents,
    tax_cents: 0,
    fee_cents: 0,
    total_cents: isBlocked ? 0 : quote.totalCents,
    currency: quote.currency,
    status,
    square_catalog_object_id: quote.squareCatalogObjectId ?? null,
    sku: quote.sku ?? null,
    source: input.source ?? 'admin',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function toSupabaseSiteUpdate(update, now) {
  const row = {
    updated_at: now.toISOString(),
  };
  const fields = {
    displayName: 'display_name',
    status: 'status',
    nightlyPriceCents: 'nightly_price_cents',
    maxRvLengthFeet: 'max_rv_length_feet',
    mapX: 'map_x',
    mapY: 'map_y',
    mapWidth: 'map_width',
    mapHeight: 'map_height',
    rotation: 'rotation',
    amp: 'amp',
    type: 'site_type',
    shade: 'shade',
    squareCatalogObjectId: 'square_catalog_object_id',
    sku: 'sku',
    sortOrder: 'sort_order',
    shortDescription: 'short_description',
    customerNotes: 'customer_notes',
    adminNotes: 'admin_notes',
  };

  for (const [field, column] of Object.entries(fields)) {
    if (field in update) row[column] = update[field];
  }
  return row;
}

function fromSupabaseSite(row, amenities = []) {
  return {
    id: row.id,
    siteNumber: row.site_number,
    displayName: row.display_name,
    status: row.status,
    nightlyPriceCents: row.nightly_price_cents,
    maxRvLengthFeet: row.max_rv_length_feet,
    mapX: row.map_x,
    mapY: row.map_y,
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    rotation: row.rotation ?? 0,
    amp: row.amp,
    type: row.site_type,
    shade: row.shade,
    squareCatalogObjectId: row.square_catalog_object_id,
    sku: row.sku,
    sortOrder: row.sort_order ?? 0,
    shortDescription: row.short_description,
    customerNotes: row.customer_notes,
    adminNotes: row.admin_notes,
    amenities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInventoryRecord(item = {}) {
  const squareItemId = item.squareItemId ?? item.square_item_id ?? item.itemId ?? item.item_id ?? null;
  const squareVariationId = item.squareVariationId ?? item.square_variation_id ?? item.variationId ?? item.variation_id ?? null;
  const squareId = item.squareId ?? item.square_id ?? squareVariationId ?? squareItemId;
  const name = String(item.name ?? '').trim();
  if (!squareId || !squareItemId || !squareVariationId || !name) return null;

  const priceCents = Number(item.priceCents ?? item.price_cents ?? item.price ?? 0);
  return {
    id: item.id ?? null,
    squareId,
    squareItemId,
    squareVariationId,
    variationId: squareVariationId,
    sku: String(item.sku ?? '').trim(),
    name,
    description: String(item.description ?? '').trim(),
    priceCents: Number.isFinite(priceCents) ? Math.round(priceCents) : 0,
    currency: String(item.currency ?? 'USD').trim() || 'USD',
    category: String(item.category ?? 'Store').trim() || 'Store',
    active: item.active !== false,
    hidden: item.hidden === true,
    source: item.source ?? 'square',
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
    createdAt: item.createdAt ?? item.created_at ?? null,
  };
}

function toSupabaseInventoryUpsert(item, now) {
  const record = normalizeInventoryRecord(item);
  if (!record) return null;
  return {
    square_id: record.squareId,
    square_item_id: record.squareItemId,
    square_variation_id: record.squareVariationId,
    sku: record.sku,
    name: record.name,
    description: record.description,
    price_cents: record.priceCents,
    currency: record.currency,
    category: record.category,
    active: record.active,
    hidden: record.hidden,
    source: record.source,
    updated_at: record.updatedAt || now.toISOString(),
  };
}

function fromSupabaseInventory(row) {
  return normalizeInventoryRecord({
    id: row.id,
    squareId: row.square_id,
    squareItemId: row.square_item_id,
    squareVariationId: row.square_variation_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents ?? (
      row.price === null || row.price === undefined ? 0 : Number(row.price) * 100
    ),
    currency: row.currency,
    category: row.category,
    active: row.active,
    hidden: row.hidden,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function fromSupabaseHold(row) {
  const rvSiteIds = normalizeJsonArray(row.rv_site_ids).length
    ? normalizeJsonArray(row.rv_site_ids)
    : [row.rv_site_id].filter(Boolean);
  return {
    id: row.id,
    rvSiteId: row.rv_site_id,
    rvSiteIds,
    siteIds: rvSiteIds,
    startDate: row.start_date,
    endDate: row.end_date,
    customerSessionId: row.customer_session_id,
    expiresAt: row.expires_at,
    convertedBookingId: row.converted_booking_id,
    status: row.status,
    quote: row.quote_snapshot ?? null,
    createdAt: row.created_at,
  };
}

function fromSupabaseBooking(row) {
  const rvSiteIds = normalizeJsonArray(row.rv_site_ids).length
    ? normalizeJsonArray(row.rv_site_ids)
    : [row.rv_site_id].filter(Boolean);
  return {
    id: row.id,
    bookingCode: row.booking_code,
    rvSiteId: row.rv_site_id,
    rvSiteIds,
    siteIds: rvSiteIds,
    siteLines: normalizeJsonArray(row.site_lines),
    holdId: row.hold_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    startDate: row.start_date,
    endDate: row.end_date,
    nights: row.nights,
    guests: row.guests,
    vehicles: row.vehicles,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    feeCents: row.fee_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    status: row.status,
    squareOrderId: row.square_order_id,
    squarePaymentId: row.square_payment_id,
    squareRefundId: row.square_refund_id,
    squareCatalogObjectId: row.square_catalog_object_id,
    sku: row.sku,
    checkoutUrl: row.checkout_url,
    expiresAt: row.expires_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
    refundAmountCents: row.refund_amount_cents,
    refundReason: row.refund_reason,
    refundedAt: row.refunded_at,
    refundedBy: row.refunded_by,
    driverLicenseStatus: row.driver_license_status ?? 'not_uploaded',
  };
}

function fromSupabaseSquareEvent(row) {
  return {
    id: row.id,
    squareEventId: row.square_event_id,
    eventType: row.event_type,
    bookingCode: row.booking_code,
    squareOrderId: row.square_order_id,
    squarePaymentId: row.square_payment_id,
    rawPayload: row.raw_payload,
    processingStatus: row.processing_status,
    processedAt: row.processed_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function fromSupabaseAuditLog(row) {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function fromSupabaseNotification(row) {
  return {
    id: row.id,
    type: row.notification_type,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    bookingCode: row.booking_code,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function fromSupabaseBookingDocument(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingCode: row.booking_code,
    documentType: row.document_type,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    status: row.status,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromSupabaseProviderConnection(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    providerKey: row.provider_key,
    providerKind: row.provider_kind,
    status: row.status,
    publicConfig: row.public_config ?? {},
    secretRef: row.secret_ref,
    encryptedCredentials: row.encrypted_credentials ?? {},
    scopes: row.scopes ?? [],
    externalAccountId: row.external_account_id,
    externalLocationId: row.external_location_id,
    lastSyncAt: row.last_sync_at,
    errorMessage: row.error_message,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSupabaseProviderConnectionUpsert(input, now) {
  return {
    tenant_id: input.tenantId ?? 'midway',
    location_id: input.locationId ?? 'plain',
    provider_key: input.providerKey,
    provider_kind: input.providerKind,
    status: input.status ?? 'not_connected',
    public_config: input.publicConfig ?? {},
    secret_ref: input.secretRef ?? null,
    encrypted_credentials: input.encryptedCredentials ?? {},
    scopes: input.scopes ?? [],
    external_account_id: input.externalAccountId ?? null,
    external_location_id: input.externalLocationId ?? null,
    last_sync_at: input.lastSyncAt ?? null,
    error_message: input.errorMessage ?? null,
    updated_by: input.updatedBy ?? null,
    updated_at: now.toISOString(),
  };
}

function createBookingCode() {
  return `MW-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function customerName(customer = {}) {
  return customer.name
    || customer.displayName
    || [customer.firstName, customer.lastName].filter(Boolean).join(' ')
    || 'Guest';
}

function resolveNow(nowOverride, clock) {
  if (nowOverride) return new Date(nowOverride);
  return new Date(clock());
}

function compareSites(a, b) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || String(a.siteNumber ?? '').localeCompare(String(b.siteNumber ?? ''));
}

function compareBookings(a, b) {
  return String(a.startDate).localeCompare(String(b.startDate))
    || String(a.createdAt).localeCompare(String(b.createdAt));
}

function compareProviderConnections(a, b) {
  return String(a.providerKind ?? '').localeCompare(String(b.providerKind ?? ''))
    || String(a.providerKey ?? '').localeCompare(String(b.providerKey ?? ''));
}

function compareInventoryItems(a, b) {
  return String(a.category ?? '').localeCompare(String(b.category ?? ''))
    || String(a.name ?? '').localeCompare(String(b.name ?? ''))
    || String(a.squareVariationId ?? '').localeCompare(String(b.squareVariationId ?? ''));
}

function availabilityError(error) {
  if (error?.code === '23P01' || error?.code === '23505') {
    return new Error('That RV site is no longer available for the selected dates.');
  }
  return error;
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(item => item !== null && item !== undefined) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function bookingDocumentsBucket(env = process.env) {
  return env.SUPABASE_BOOKING_DOCUMENTS_BUCKET
    || env.SUPABASE_STORAGE_BUCKET_DOCUMENTS
    || 'booking-documents';
}

function safeDocumentFileName(fileName = '', contentType = '') {
  const fallbackExtension = contentType === 'image/png'
    ? 'png'
    : contentType === 'image/webp'
      ? 'webp'
      : 'jpg';
  const safe = String(fileName || `driver-license.${fallbackExtension}`)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return safe || `driver-license.${fallbackExtension}`;
}

function clone(value) {
  return structuredClone(value);
}
