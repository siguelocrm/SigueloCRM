// Imitación mínima del cliente de Supabase (solo lo que usa server/src/siguelo)
// sobre un Postgres en memoria (PGlite), con un reloj falso.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

export const pg = new PGlite();
export const reloj = { ahora: Date.now() };

const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(reloj.ahora);
    else super(...a);
  }
  static now() {
    return reloj.ahora;
  }
}
globalThis.Date = FakeDate;

export async function prepararBase() {
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (bucket_id text, name text);
    create publication supabase_realtime;
  `);
  const R = fileURLToPath(new URL('../database/', import.meta.url));
  await pg.exec(fs.readFileSync(R + 'instalar.sql', 'utf8').replace(/create extension if not exists pgcrypto;/, ''));
  await pg.exec(fs.readFileSync(R + 'siguelo.sql', 'utf8'));
}

const tipos = new Map();
async function tipoColumna(tabla, col) {
  const k = `${tabla}.${col}`;
  if (!tipos.has(k)) {
    const r = await pg.query(`select data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [tabla, col]);
    tipos.set(k, r.rows[0]?.udt_name ?? null);
  }
  return tipos.get(k);
}

const literalTextos = (arr) => '{' + arr.map((s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';

async function valor(tabla, col, v) {
  if (v === null || v === undefined) return { sql: 'null' };
  const t = await tipoColumna(tabla, col);
  if (t === 'jsonb' || t === 'json') return { sql: '::jsonb', v: JSON.stringify(v) };
  if (t === '_text') return { sql: '::text[]', v: literalTextos(v) };
  if (t === 'timestamptz') return { sql: '::timestamptz', v: v instanceof RealDate ? v.toISOString() : String(v) };
  return { sql: '', v };
}

// Fechas como texto ISO y números como números, igual que la API de Supabase.
function normalizar(rows, fields) {
  const numericos = new Set(fields.filter((f) => f.dataTypeID === 1700 || f.dataTypeID === 20).map((f) => f.name));
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof RealDate) o[k] = v.toISOString();
      else if (typeof v === 'bigint') o[k] = Number(v);
      else if (numericos.has(k) && v !== null) o[k] = Number(v);
      else o[k] = v;
    }
    return o;
  });
}

// Tablas cuyo creado_en usa el reloj falso (Postgres usa la hora real).
const CON_CREADO_EN = new Set(['mensajes', 'siguelo_cola', 'siguelo_registro', 'siguelo_seguimientos', 'contactos', 'conversaciones']);

class Consulta {
  constructor(tabla) {
    this.t = tabla;
    this.op = 'select';
    this.cols = '*';
    this.filtros = [];
    this.orden = [];
    this.lim = null;
    this.ret = null;
    this.uno = null;
  }
  select(cols = '*', opciones = {}) {
    if (this.op === 'select') {
      this.cols = cols;
      this.contar = !!opciones.count;
    } else this.ret = cols;
    return this;
  }
  // Como supabase-js: en un insert de varias filas, lo que falta en una fila queda NULL (no el valor por
  // defecto de la columna), salvo que se pida { defaultToNull: false }.
  insert(filas, opts = {}) { this.op = 'insert'; this.filas = Array.isArray(filas) ? filas : [filas]; this.alNull = Array.isArray(filas) && filas.length > 1 && opts.defaultToNull !== false; return this; }
  upsert(filas, opts = {}) { this.op = 'upsert'; this.filas = Array.isArray(filas) ? filas : [filas]; this.opts = opts; return this; }
  update(obj) { this.op = 'update'; this.obj = obj; return this; }
  delete() { this.op = 'delete'; return this; }
  f(c, op, v) { this.filtros.push({ c, op, v }); return this; }
  eq(c, v) { return this.f(c, '=', v); }
  neq(c, v) { return this.f(c, '<>', v); }
  gt(c, v) { return this.f(c, '>', v); }
  gte(c, v) { return this.f(c, '>=', v); }
  lt(c, v) { return this.f(c, '<', v); }
  lte(c, v) { return this.f(c, '<=', v); }
  ilike(c, v) { return this.f(c, 'ilike', v); }
  like(c, v) { return this.f(c, 'like', v); }
  in(c, v) { return this.f(c, 'in', v); }
  is(c, v) { return this.f(c, 'is', v); }
  or(texto) { this.filtros.push({ or: texto }); return this; }
  order(c, { ascending = true } = {}) { this.orden.push(`${c} ${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  range(desde, hasta) { this.lim = hasta - desde + 1; this.desde = desde; return this; }
  maybeSingle() { this.uno = 'quizas'; return this; }
  single() { this.uno = 'uno'; return this; }
  then(ok, mal) { return this.correr().then(ok, mal); }

  async where(params) {
    const partes = [];
    for (const x of this.filtros) {
      if (x.or) {
        const ors = [];
        for (const p of x.or.split(',')) {
          const [c, op, ...resto] = p.split('.');
          if (op !== 'eq' && op !== 'like') throw new Error('or: solo eq y like');
          params.push(resto.join('.'));
          ors.push(`${c}::text ${op === 'like' ? 'like' : '='} $${params.length}`);
        }
        partes.push(`(${ors.join(' or ')})`);
        continue;
      }
      if (x.op === 'is') { partes.push(`${x.c} is ${x.v === null ? 'null' : x.v}`); continue; }
      if (x.op === 'in') {
        const t = await tipoColumna(this.t, x.c);
        params.push(x.v);
        partes.push(`${x.c}::text = any($${params.length}::text[])`);
        void t;
        continue;
      }
      const val = await valor(this.t, x.c, x.v);
      params.push(val.v);
      partes.push(`${x.c} ${x.op} $${params.length}${val.sql}`);
    }
    return partes.length ? ` where ${partes.join(' and ')}` : '';
  }

  async correr() {
    try {
      const params = [];
      let sql;
      if (this.op === 'select' && this.contar) {
        const r = await pg.query(`select count(*)::int as n from ${this.t}${await this.where(params)}`, params);
        return { data: null, count: r.rows[0].n, error: null };
      }
      if (this.op === 'select') {
        sql = `select ${this.cols} from ${this.t}${await this.where(params)}`;
        if (this.orden.length) sql += ` order by ${this.orden.join(', ')}`;
        // Como Supabase: como mucho db.maxFilas filas por pedido (1000), aunque se pidan más.
        const lim = Math.min(this.lim || Infinity, TABLAS_GRANDES.has(this.t) ? db.maxFilas : 1000);
        if (lim !== Infinity) sql += ` limit ${lim}`;
        if (this.desde) sql += ` offset ${this.desde}`;
      } else if (this.op === 'insert' || this.op === 'upsert') {
        const filas = this.filas.map((f) => (CON_CREADO_EN.has(this.t) && !('creado_en' in f) ? { ...f, creado_en: new RealDate(reloj.ahora).toISOString() } : f));
        if (!filas.length) return { data: [], error: null };
        const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
        const valores = [];
        for (const f of filas) {
          const vs = [];
          for (const c of cols) {
            const v = await valor(this.t, c, f[c]);
            if (v.sql === 'null') vs.push(f[c] === undefined && !this.alNull ? 'default' : 'null');
            else { params.push(v.v); vs.push(`$${params.length}${v.sql}`); }
          }
          valores.push(`(${vs.join(', ')})`);
        }
        sql = `insert into ${this.t} (${cols.join(', ')}) values ${valores.join(', ')}`;
        if (this.op === 'upsert') {
          const conflicto = this.opts.onConflict || 'id';
          sql += this.opts.ignoreDuplicates ? ` on conflict (${conflicto}) do nothing` : ` on conflict (${conflicto}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`;
        }
        if (this.ret) sql += ` returning ${this.ret}`;
      } else if (this.op === 'update') {
        const sets = [];
        for (const [c, v0] of Object.entries(this.obj)) {
          const v = await valor(this.t, c, v0);
          if (v.sql === 'null') sets.push(`${c} = null`);
          else { params.push(v.v); sets.push(`${c} = $${params.length}${v.sql}`); }
        }
        sql = `update ${this.t} set ${sets.join(', ')}${await this.where(params)}`;
        if (this.ret) sql += ` returning ${this.ret}`;
      } else {
        sql = `delete from ${this.t}${await this.where(params)}`;
      }
      const r = await pg.query(sql, params);
      if (this.t === 'contactos' && (this.op === 'insert' || this.op === 'upsert')) {
        // El disparador pone etapa_actualizada_en = now() (hora real): se pasa al reloj falso.
        await pg.query(`update contactos set etapa_actualizada_en = $1::timestamptz where etapa_actualizada_en > $1::timestamptz`, [new RealDate(reloj.ahora).toISOString()]);
      }
      let data = this.op === 'select' || this.ret ? normalizar(r.rows, r.fields) : null;
      if (this.uno) {
        if (this.uno === 'uno' && data.length !== 1) return { data: null, error: { message: `se esperaba 1 fila y hubo ${data.length}` } };
        data = data[0] ?? null;
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }
}

// Usuarios de Supabase Auth falsos (correo → contraseña), para crear cuentas.
export const usuariosAuth = new Map();
const auth = {
  admin: {
    async createUser({ email, password }) {
      if ([...usuariosAuth.values()].some((u) => u.email === email)) return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } };
      const id = crypto.randomUUID();
      usuariosAuth.set(id, { id, email, password });
      return { data: { user: { id, email } }, error: null };
    },
    async deleteUser(id) {
      usuariosAuth.delete(id);
      return { data: {}, error: null };
    },
    async updateUserById(id, cambios) {
      const u = usuariosAuth.get(id);
      if (!u) return { data: null, error: { message: 'User not found' } };
      Object.assign(u, cambios);
      return { data: { user: u }, error: null };
    },
  },
};

// Las tablas que en una cuenta real pasan de 1000 filas (las pruebas bajan db.maxFilas para verlo con pocas).
const TABLAS_GRANDES = new Set(['contactos', 'conversaciones', 'mensajes', 'siguelo_seguimientos', 'siguelo_cola']);

export const db = {
  auth,
  from: (t) => new Consulta(t),
  // Filas que devuelve Supabase como mucho en un pedido (para probar que se lee por partes).
  maxFilas: 1000,
  // Como supabase-js: .rpc() se puede seguir con .order() y .range() (y también devuelve 1000 filas como mucho).
  rpc(fn, args) {
    const orden = [];
    let desde = 0;
    let lim = null;
    const correr = async () => {
      try {
        const claves = Object.keys(args);
        let sql = `select * from ${fn}(${claves.map((_, i) => `$${i + 1}`).join(', ')})`;
        if (orden.length) sql += ` order by ${orden.join(', ')}`;
        const tope = Math.min(lim ?? Infinity, db.maxFilas);
        if (tope !== Infinity) sql += ` limit ${tope}`;
        if (desde) sql += ` offset ${desde}`;
        const r = await pg.query(sql, claves.map((k) => args[k]));
        const filas = normalizar(r.rows, r.fields);
        // Una función que devuelve un solo valor: Supabase devuelve ese valor, no una fila.
        if (r.fields.length === 1 && r.fields[0].name === fn && filas.length === 1) return { data: filas[0][fn], error: null };
        return { data: filas, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    };
    const q = {
      order(c, { ascending = true } = {}) { orden.push(`${c} ${ascending ? 'asc' : 'desc'}`); return q; },
      range(d, h) { desde = d; lim = h - d + 1; return q; },
      then(ok, mal) { return correr().then(ok, mal); },
    };
    return q;
  },
};

// Los mismos ayudantes que server/src/siguelo/db.ts.
// Las páginas son del tamaño del tope (en Supabase, las dos son de 1000).
export async function todas(pedir, tope = 50_000) {
  const filas = [];
  const pagina = Math.min(1000, db.maxFilas);
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await pedir(desde, desde + pagina - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
    if (!data || data.length < pagina || filas.length >= tope) return filas;
  }
}
// Los grupos se achican en la misma proporción que el tope (200 o 300 ids de 1000 filas).
export async function porGrupos(ids, pedir, tam = 200) {
  const filas = [];
  tam = Math.max(1, Math.floor((tam * db.maxFilas) / 1000));
  for (let i = 0; i < ids.length; i += tam) {
    const { data, error } = await pedir(ids.slice(i, i + tam));
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
  }
  return filas;
}
