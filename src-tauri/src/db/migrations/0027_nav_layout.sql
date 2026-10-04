-- Navigation layout (Settings > Appearance > Navigation): the user's chosen
-- order of the nav items and which of them are hidden, stored the same way
-- dashboard_layout_json is — a JSON array — rather than as a table, because
-- it is a small ordered list that is only ever read and written whole.
--
-- Shape: [{"id": "planner", "hidden": false}, ...]. The item registry itself
-- (ids, labels, routes) lives in the frontend (src/app/navItems.ts); anything
-- missing from this list is appended in default order at read time, and
-- unknown ids are ignored, so adding or removing a page later never needs a
-- migration. An empty list ('[]', the default) means "default order, nothing
-- hidden", so nobody's navigation changes on upgrade.
--
-- No CHECK constraint, per migration 0009's note on ALTER TABLE ADD COLUMN;
-- the shape is validated in Rust (commands/settings.rs).

ALTER TABLE user_settings ADD COLUMN nav_layout_json TEXT NOT NULL DEFAULT '[]';
