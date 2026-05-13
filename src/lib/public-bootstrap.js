export function normalizeSquareProducts(products = []) {
  return products
    .map(product => {
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
        source: 'square',
      };
    })
    .filter(product => product.id && product.name && product.priceCents > 0);
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
  featureFlags = {},
} = {}) {
  const products = normalizeSquareProducts(squareProducts);
  const normalizedFuel = normalizeFuelPrices(fuelPrices);
  const requestedFlags = featureFlags ?? {};
  const resolvedFlags = {
    ...requestedFlags,
    fuel: normalizedFuel.length > 0 && requestedFlags.fuel !== false,
    products: products.length > 0 && requestedFlags.products !== false,
    rvBooking: rvSites.length > 0 && requestedFlags.rvBooking !== false,
    events: events.length > 0 && requestedFlags.events === true,
    coffee: Object.keys(coffeeMenu ?? {}).length > 0 && requestedFlags.coffee === true,
    hours: hours.length > 0 && requestedFlags.hours !== false,
    instagram: Boolean(settings.instagramHandle || settings.instagramUrl || settings.instagramPosts?.length) && requestedFlags.instagram === true,
  };

  return {
    settings,
    hours,
    fuelPrices: normalizedFuel,
    rvSites,
    rvAvailability,
    products,
    events,
    coffeeMenu,
    featureFlags: resolvedFlags,
  };
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
