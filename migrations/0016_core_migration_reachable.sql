alter table developer_core_migration add column if not exists target_reachable boolean not null default false;
