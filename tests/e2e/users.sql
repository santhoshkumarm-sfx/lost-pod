insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'super@sfx.test', '{"role":"super_admin"}', '{"full_name":"Binay Sharma"}'),
  ('00000000-0000-0000-0000-000000000002', 'admin@sfx.test', '{"role":"admin"}', '{"full_name":"Santhosh Kumar"}'),
  ('00000000-0000-0000-0000-000000000003', 'agent@sfx.test', '{"role":"internal_team"}', '{"full_name":"Assem Khan"}'),
  ('00000000-0000-0000-0000-000000000004', 'poc@velocity.test', '{"role":"client_poc"}', '{"full_name":"Vel POC"}'),
  ('00000000-0000-0000-0000-000000000005', 'poc@naaptol.test', '{"role":"client_poc"}', '{"full_name":"Naap POC"}');
insert into client_pocs (client_id, user_id, name, email) select id, '00000000-0000-0000-0000-000000000004', 'Vel POC', 'poc@velocity.test' from clients where name='Velocity';
insert into client_pocs (client_id, user_id, name, email) select id, '00000000-0000-0000-0000-000000000005', 'Naap POC', 'poc@naaptol.test' from clients where name='Naaptol';
update clients set email_domains = '{velocity.in}' where name = 'Velocity';
grant anon, authenticated, service_role to authenticator;
