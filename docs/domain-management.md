# Domain Management

## Purpose

MidwayOS should eventually let each tenant connect one or more custom domains without developer involvement.

The domain system should support:

- platform subdomains
- custom root/apex domains
- custom `www` domains
- DNS verification
- automatic SSL
- primary domain selection
- redirects
- preview domains
- safe rollback

## Owner/Tenant Flow

1. Tenant opens Settings -> Domains.
2. Tenant enters a domain.
3. MidwayOS shows DNS instructions.
4. Tenant updates DNS at their registrar.
5. Tenant clicks "Verify."
6. MidwayOS checks DNS.
7. MidwayOS provisions SSL.
8. Tenant sets primary domain.
9. Requests to that domain route to the tenant's frontend config.

Example DNS instructions:

```text
Type: CNAME
Name: www
Value: cname.midwayos.com
```

For apex/root domains:

```text
Type: A
Name: @
Value: platform IP address
```

Exact DNS records depend on hosting provider.

## Routing Model

Incoming request:

```text
Host: midwayplain.com
```

Resolution:

```text
host -> tenant_domains lookup -> tenant_id -> frontend_config -> render site
```

Admin access should not depend on a tenant's custom domain. Always keep a platform fallback domain.

Example:

```text
midway.midwayos.com
```

## Data Model

### tenant_domains

- id
- tenant_id
- domain
- normalized_domain
- type: platform_subdomain, custom_apex, custom_www, preview
- status: pending_dns, verifying, active, failed, disabled
- is_primary
- verification_token
- dns_target
- ssl_status: not_started, pending, active, failed
- ssl_provider_id
- redirect_to_domain_id
- last_checked_at
- verified_at
- created_by
- created_at
- updated_at

## Domain Rules

- A domain can belong to only one tenant.
- A domain cannot become primary until DNS and SSL are active.
- A tenant should always have at least one fallback platform subdomain.
- Domain changes must be audited.
- Domain removal should not delete content or tenant config.
- Failed DNS verification should show plain-language instructions.

## Feature Flags

- `domains.enabled`
- `domains.custom_domains`
- `domains.apex_domains`
- `domains.www_redirect`
- `domains.auto_ssl`
- `domains.preview_domains`

## Platform Admin Controls

Platform admin should be able to:

- view all tenant domains
- add/remove a domain
- force re-verify
- view DNS status
- view SSL status
- disable a domain
- transfer a domain between tenants only through an audited admin action

## Hosting Options

Good candidates:

- Vercel
- Netlify
- Cloudflare Pages/Workers
- AWS CloudFront later

Selection criteria:

- custom domain API
- automatic SSL
- wildcard domain support
- preview deployments
- edge routing
- good observability
- rollback support

## MVP Position

Custom domains are not required for the first working Midway launch if the current domain is manually configured.

However, the MVP should avoid assumptions that make domains hard later:

- route public site by host
- keep tenant/domain concepts in data model
- keep frontend config tenant-aware
- avoid hard-coded production domain in app logic

## Tests

Domain tests should cover:

- host resolves to correct tenant
- unknown host shows safe fallback
- duplicate domain rejected
- primary domain requires verified DNS and active SSL
- disabled domain does not serve tenant content
- admin access remains available if custom domain fails

