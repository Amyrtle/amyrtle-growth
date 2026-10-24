CREATE TABLE campaign_assets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), content BLOB NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type='image/webp'), size INTEGER NOT NULL CHECK(size>0), copyright_confirmed INTEGER NOT NULL CHECK(copyright_confirmed=1), created_at TEXT NOT NULL);
CREATE INDEX asset_tenant ON campaign_assets(tenant_id);
ALTER TABLE tenants ADD COLUMN logo_asset_id TEXT REFERENCES campaign_assets(id);
INSERT INTO schema_migrations VALUES(2, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
