export function normalizeSquareProducts(products = []) {
  return products
    .map(product => {
      if (product.squareVariationId || product.square_variation_id || product.priceCents || product.price_cents) {
        const priceCents = Number(product.priceCents ?? product.price_cents ?? 0);
        return {
          id: product.squareItemId ?? product.square_item_id ?? product.id,
          variationId: product.squareVariationId ?? product.square_variation_id ?? product.variationId ?? null,
          sku: product.sku ?? '',
          name: product.name,
          description: product.description ?? '',
          priceCents,
          currency: product.currency ?? 'USD',
          category: product.category ?? 'Store',
          active: product.active !== false,
          hidden: product.hidden === true,
          source: product.source ?? 'square',
        };
      }

      const itemData = product.itemData ?? product.item_data ?? {};
      const variation = itemData.variations?.[0];
      const variationData = variation?.itemVariationData ?? variation?.item_variation_data ?? {};
      const priceMoney = variationData.priceMoney ?? variationData.price_money ?? {};
      const rawAmount = priceMoney.amount;
      const priceCents = typeof rawAmount === 'bigint' ? Number(rawAmount) : Number(rawAmount ?? 0);

      return {
        id: product.id,
        variationId: variation?.id ?? product.variationId ?? null,
        sku: variationData.sku ?? product.sku ?? '',
        name: itemData.name ?? product.name,
        description: itemData.description ?? product.description ?? '',
        priceCents,
        currency: priceMoney.currency ?? product.currency ?? 'USD',
        category: itemData.categories?.[0]?.name ?? product.category ?? 'Store',
        active: product.active !== false,
        hidden: product.hidden === true,
        source: 'square',
      };
    })
    .filter(product => product.id && product.name && product.priceCents > 0 && product.active && !product.hidden)
    .filter(product => !isBookingCatalogProduct(product))
    .map(({ active, hidden, ...product }) => product);
}

function isBookingCatalogProduct(product = {}) {
  const sku = String(product.sku || '').trim().toUpperCase();
  return sku === 'MIDWAY-EXTRA-VEHICLE'
    || sku.startsWith('MIDWAY-RV-')
    || sku.startsWith('MIDWAY-TENT-');
}

export function buildPublicBootstrap({
  settings = {},
  hours = [],
  fuelPrices = [],
  rvSites = [],
  rvAvailability = [],
  squareProducts = [],
  events = [],
  coffeeMenu = [],
  sections = [],
  featureFlags = {},
} = {}) {
  const normalizedSections = normalizePublicSections(settings.sections ?? sections);
  const sectionData = contentFromSections(normalizedSections);
  const resolvedEvents = events.length ? events : sectionData.events;
  const resolvedCoffeeMenu = Object.keys(coffeeMenu ?? {}).length ? coffeeMenu : sectionData.coffeeMenu;
  const products = normalizeSquareProducts(squareProducts);
  const normalizedFuel = normalizeFuelPrices(fuelPrices);
  const sectionEnabled = key => {
    const section = normalizedSections.find(candidate => candidate.key === key);
    return section ? section.enabled !== false : true;
  };
  const requestedFlags = featureFlags ?? {};
  const resolvedFlags = {
    ...requestedFlags,
    fuel: normalizedFuel.length > 0 && requestedFlags.fuel !== false,
    products: products.length > 0 && requestedFlags.products !== false && sectionEnabled('products'),
    rvBooking: rvSites.length > 0 && requestedFlags.rvBooking !== false,
    events: resolvedEvents.length > 0 && requestedFlags.events === true && sectionEnabled('events'),
    coffee: Object.keys(resolvedCoffeeMenu ?? {}).length > 0 && requestedFlags.coffee === true && sectionEnabled('coffee'),
    hours: hours.length > 0 && requestedFlags.hours !== false,
    instagram: hasInstagramContent(settings, normalizedSections) && requestedFlags.instagram === true && sectionEnabled('instagram'),
  };

  return {
    settings,
    sections: normalizedSections,
    hours,
    fuelPrices: normalizedFuel,
    rvSites,
    rvAvailability,
    products,
    events: resolvedEvents,
    coffeeMenu: resolvedCoffeeMenu,
    featureFlags: resolvedFlags,
  };
}

export function normalizePublicSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map(section => ({
      key: String(section.key || '').trim(),
      enabled: section.enabled !== false,
      title: String(section.title || '').trim(),
      copy: String(section.copy || '').trim(),
      items: normalizeSectionItems(section.items),
    }))
    .filter(section => section.key);
}

function contentFromSections(sections) {
  const eventsSection = sections.find(section => section.key === 'events');
  const coffeeSection = sections.find(section => section.key === 'coffee');

  return {
    events: eventsSection?.items ?? [],
    coffeeMenu: coffeeSection?.items?.length
      ? {
          Menu: coffeeSection.items.map(item => ({
            n: item.name || item.title || '',
            p: item.price || '',
            d: item.description || item.copy || '',
          })).filter(item => item.n),
        }
      : {},
  };
}

function hasInstagramContent(settings, sections) {
  return Boolean(settings.instagramFeed?.length);
}

function normalizeSectionItems(items = []) {
  const values = Array.isArray(items) ? items : String(items || '').split('\n');
  return values
    .map(item => {
      if (item && typeof item === 'object') return item;
      const [title, dateOrPrice, description] = String(item || '').split('|').map(value => value.trim());
      if (!title) return null;
      return {
        title,
        name: title,
        date: dateOrPrice || '',
        price: dateOrPrice || '',
        description: description || '',
      };
    })
    .filter(Boolean);
}

function normalizeFuelPrices(fuelPrices) {
  if (Array.isArray(fuelPrices)) {
    return fuelPrices
      .map(price => ({
        type: price.type,
        label: price.label ?? labelFuelType(price.type),
        price: Number(price.price),
        updatedAt: price.updatedAt ?? price.updated_at ?? null,
      }))
      .filter(price => price.type && Number.isFinite(price.price));
  }

  return Object.entries(fuelPrices ?? {})
    .filter(([, price]) => Number.isFinite(Number(price)))
    .map(([type, price]) => ({
      type,
      label: labelFuelType(type),
      price: Number(price),
      updatedAt: fuelPrices.updatedAt ?? null,
    }));
}

function labelFuelType(type = '') {
  if (type === 'diesel') return 'Diesel';
  if (type === 'unleaded') return 'Non Ethanol';
  return type.replaceAll('_', ' ');
}
