const M = require('../js/motor-calificacion.js');
let fallos = 0;
function ok(nombre, real, esperado) {
  const a = typeof real === 'number' ? Math.round(real * 100) / 100 : real;
  const b = typeof esperado === 'number' ? Math.round(esperado * 100) / 100 : esperado;
  const bien = a === b;
  if (!bien) fallos++;
  console.log((bien ? 'OK   ' : 'FALLA ') + nombre + ' → ' + a + (bien ? '' : ' (esperado ' + b + ')'));
}
const PESOS = { tareas: 28, trabajos: 28, participacion: 6, conducta: 5, examen: 33 };

ok('nivel logrado', M.puntajeProducto({ nivel: 'logrado', estado_entrega: 'entregado' }), 1);
ok('nivel en_proceso', M.puntajeProducto({ nivel: 'en_proceso', estado_entrega: 'entregado' }), 0.7);
ok('puntaje 8 manda sobre nivel', M.puntajeProducto({ nivel: 'requiere_apoyo', puntaje: 8 }), 0.8);
ok('puntaje 0 cuenta como 0', M.puntajeProducto({ puntaje: 0, estado_entrega: 'entregado' }), 0);
ok('no entregado', M.puntajeProducto({ estado_entrega: 'no_entregado' }), 0);
ok('incompleto sin nivel', M.puntajeProducto({ estado_entrega: 'incompleto' }), 0.5);
ok('justificado se excluye', M.puntajeProducto({ estado_entrega: 'justificado', nivel: 'logrado' }), null);
ok('no_aplica se excluye', M.puntajeProducto({ estado_entrega: 'no_aplica' }), null);
ok('sin capturar se excluye', M.puntajeProducto(undefined), null);

let r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 'p1', tipo: 'tarea', campo: 'LEN' }, { id: 'p2', tipo: 'tarea', campo: 'LEN' }, { id: 'p3', tipo: 'tarea', campo: 'LEN' }],
  calificaciones: { p1: { nivel: 'logrado' }, p2: { estado_entrega: 'justificado' } },
});
ok('maximo descuenta justificado (1 de 1)', r.LEN.rubros.tareas.maximo, 1);
ok('solo tareas → 100%', r.LEN.porcentaje, 100);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 'p1', tipo: 'tarea', campo: 'LEN' }, { id: 'p2', tipo: 'trabajo', campo: 'LEN' }],
  calificaciones: { p1: { nivel: 'logrado' }, p2: { nivel: 'requiere_apoyo' } },
});
ok('tareas 100% + trabajos 40% (pesos iguales) → 70%', r.LEN.porcentaje, 70);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: { tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 38 },
  productos: [{ id: 'p1', tipo: 'tarea', campo: 'LEN' }],
  calificaciones: { p1: { nivel: 'logrado' } },
  registros: [{ fecha: '2026-09-21', participacion: 2, conducta: 0 }],
  camposPorFecha: { '2026-09-21': ['LEN'] },
});
ok('conducta con peso 0 se ignora', r.LEN.porcentaje, 100);

r = M.calcularPorcentajes({
  campos: ['LEN', 'SAB'], pesos: { tareas: 0, trabajos: 0, participacion: 50, conducta: 50, examen: 0 },
  productos: [], calificaciones: {},
  registros: [{ fecha: '2026-09-21', participacion: 1, conducta: 2 }],
  camposPorFecha: { '2026-09-21': ['LEN', 'SAB'] },
});
ok('participacion repartida 50/50 → maximo 0.5 en LEN', r.LEN.rubros.participacion.maximo, 0.5);
// Decisión 9 (2026-09-24): 1 (normal) y 2 (destacado) valen el día completo
ok('part 1 + conducta 2 → 100% (el 2 no suma de más)', r.LEN.porcentaje, 100);
ok('mismo resultado en SAB', r.SAB.porcentaje, 100);
ok('el 2 queda contado como destacado (medio día en LEN)', r.LEN.rubros.conducta.diario.destacados, 0.5);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS, productos: [], calificaciones: {},
  registros: [{ fecha: '2026-09-20', participacion: 0, conducta: 0 }],
  camposPorFecha: { '2026-09-21': ['LEN'] },
});
ok('dia sin sesion no cuenta', r.LEN.rubros.participacion.maximo, 0);
ok('sin evidencias → porcentaje null', r.LEN.porcentaje, null);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS, productos: [], calificaciones: {},
  legacy: [{ rubro: 'tareas', campo: 'LEN', calificacion: 10 }, { rubro: 'tareas', campo: 'LEN', calificacion: 5 }],
});
ok('legacy 10 y 5 → 75%', r.LEN.porcentaje, 75);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: { tareas: 0, trabajos: 0, participacion: 0, conducta: 0, examen: 100 },
  productos: [], calificaciones: {}, examenPorCampo: { LEN: 0.62 },
});
ok('solo examen → 62%', r.LEN.porcentaje, 62);

r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 'p1', tipo: 'tarea', campo: 'LEN' }, { id: 'p2', tipo: 'trabajo', campo: 'LEN' }],
  calificaciones: { p1: { estado_entrega: 'no_entregado' }, p2: { nivel: 'requiere_apoyo' } },
  registros: [{ fecha: '2026-09-21', participacion: 1, conducta: 1 }],
  camposPorFecha: { '2026-09-21': ['LEN'] },
  examenPorCampo: { LEN: 0.3 },
});
ok('alumno en riesgo → menos de 50%', r.LEN.porcentaje < 50, true);
ok('rubro tareas 0 de 1', r.LEN.rubros.tareas.obtenido + '/' + r.LEN.rubros.tareas.maximo, '0/1');
ok('producto de otro campo no contamina', r.LEN.rubros.trabajos.maximo, 1);

// Entrega, aparte de la calidad (la usan los textos; la calificación no cambia)
r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: ['a', 'b', 'c', 'd', 'e', 'f'].map(function (id) { return { id: id, tipo: 'trabajo', campo: 'LEN' }; }),
  calificaciones: {
    a: { estado_entrega: 'entregado', nivel: 'requiere_apoyo' },
    b: { estado_entrega: 'no_entregado' },
    c: { estado_entrega: 'incompleto', nivel: 'en_proceso' },
    d: { estado_entrega: 'justificado' },
    e: { estado_entrega: null, nivel: null }, // marcado y desmarcado: sin revisar
  },
});
const ent = r.LEN.rubros.trabajos.entrega;
ok('entrega: esperados excluye justificado y sin revisar', ent.esperados, 3);
ok('entrega: entregados cuenta entregado + incompleto', ent.entregados, 2);
ok('entrega: completos solo entregado', ent.completos, 1);
ok('entrega: calidad de lo entregado (0.4 + 0.7)', Math.round(ent.sumaEntregados * 10) / 10, 1.1);
ok('entrega: la calificación no cambia (0.4 + 0 + 0.7 de 3)', Math.round(r.LEN.rubros.trabajos.fraccion * 1000) / 1000, 0.367);
ok('entrega: participación no lleva conteo de entrega', r.LEN.rubros.participacion.entrega, undefined);

// ── Participación y conducta: 0, 1 y 2 (decisión de Jorge 9, 2026-09-24) ───────
const P = { tareas: 0, trabajos: 0, participacion: 50, conducta: 50, examen: 0 };
function diario(valores) {
  const registros = valores.map(function (v, i) { return { fecha: '2026-09-' + (10 + i), participacion: v, conducta: v }; });
  const camposPorFecha = {};
  registros.forEach(function (x) { camposPorFecha[x.fecha] = ['LEN']; });
  return M.calcularPorcentajes({ campos: ['LEN'], pesos: P, productos: [], calificaciones: {}, registros: registros, camposPorFecha: camposPorFecha });
}
r = diario([1, 1, 1, 1]);
ok('todos los días en 1 → participación 100 %', r.LEN.rubros.participacion.fraccion * 100, 100);
ok('todos los días en 1 → conducta 100 %', r.LEN.rubros.conducta.fraccion * 100, 100);
ok('todos en 1: obtenido 4 de 4', r.LEN.rubros.participacion.obtenido + '/' + r.LEN.rubros.participacion.maximo, '4/4');
ok('todos en 1: ningún destacado', r.LEN.rubros.participacion.diario.destacados, 0);
r = diario([2, 2, 2, 2]);
ok('todos en 2 → 100 % (no más)', r.LEN.rubros.participacion.fraccion * 100, 100);
ok('todos en 2: 4 días destacados', r.LEN.rubros.participacion.diario.destacados, 4);
r = diario([0, 0, 0, 0]);
ok('todos en 0 → 0 %', r.LEN.rubros.participacion.fraccion * 100, 0);
ok('todos en 0: 4 días en cero', r.LEN.rubros.participacion.diario.ceros, 4);
r = diario([0, 1, 2, 1]);
ok('0, 1, 2, 1 → 75 % (solo el 0 resta)', r.LEN.rubros.participacion.fraccion * 100, 75);
ok('0, 1, 2, 1: días 4, destacados 1, ceros 1', JSON.stringify(r.LEN.rubros.participacion.diario), JSON.stringify({ dias: 4, destacados: 1, ceros: 1 }));
r = M.calcularPorcentajes({ campos: ['LEN'], pesos: P, productos: [], calificaciones: {},
  registros: [{ fecha: '2026-09-10', participacion: null, conducta: 1 }], camposPorFecha: { '2026-09-10': ['LEN'] } });
ok('participación sin dato ese día no entra al máximo', r.LEN.rubros.participacion.maximo, 0);
ok('pero la conducta del día sí', r.LEN.rubros.conducta.maximo, 1);
// Con los pesos por defecto (28/28/6/5/33): un alumno normal ya no pierde 5.5 puntos
r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 't', tipo: 'tarea', campo: 'LEN' }, { id: 'w', tipo: 'trabajo', campo: 'LEN' }],
  calificaciones: { t: { nivel: 'logrado' }, w: { nivel: 'logrado' } },
  registros: [{ fecha: '2026-09-21', participacion: 1, conducta: 1 }], camposPorFecha: { '2026-09-21': ['LEN'] },
  examenPorCampo: { LEN: 1 },
});
ok('todo logrado, examen perfecto y días normales → 100 %', r.LEN.porcentaje, 100);

// ── La conducta no pondera (decisión de Jorge del 2026-09-24; LGE art. 21) ─────────
// Se sigue registrando y contando (textos y reportes), pero su peso es siempre 0, aunque
// los ajustes traigan uno (PESOS trae conducta 5): se reparte como un rubro sin datos.
r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 't', tipo: 'tarea', campo: 'LEN' }, { id: 'w', tipo: 'trabajo', campo: 'LEN' }],
  calificaciones: { t: { nivel: 'logrado' }, w: { nivel: 'logrado' } },
  registros: [{ fecha: '2026-09-21', participacion: 1, conducta: 0 }, { fecha: '2026-09-22', participacion: 1, conducta: 0 }],
  camposPorFecha: { '2026-09-21': ['LEN'], '2026-09-22': ['LEN'] },
  examenPorCampo: { LEN: 1 },
});
ok('conducta en 0 todos los días no baja el porcentaje (100 %)', r.LEN.porcentaje, 100);
ok('conducta: peso 0 aunque los ajustes digan 5', r.LEN.rubros.conducta.peso, 0);
ok('conducta: marcada como referencia', r.LEN.rubros.conducta.referencia, true);
ok('conducta: se sigue contando (0 de 2 días)', r.LEN.rubros.conducta.obtenido + '/' + r.LEN.rubros.conducta.maximo, '0/2');
ok('conducta: la fracción sigue disponible para textos y reportes', r.LEN.rubros.conducta.fraccion, 0);
ok('conducta: los días en cero siguen contados (textos)', r.LEN.rubros.conducta.diario.ceros, 2);
ok('solo conducta con datos → sin porcentaje (no pondera)', M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS, productos: [], calificaciones: {},
  registros: [{ fecha: '2026-09-21', participacion: null, conducta: 2 }], camposPorFecha: { '2026-09-21': ['LEN'] },
}).LEN.porcentaje, null);
// Cuadre a mano con 28/28/6/33: tareas 1 de 2 (0.5), trabajos en proceso (0.7),
// participación 3 de 4 días (0.75), examen 0.6 → (14 + 19.6 + 4.5 + 19.8) / 95 = 60.947... %
r = M.calcularPorcentajes({
  campos: ['LEN'], pesos: PESOS,
  productos: [{ id: 't1', tipo: 'tarea', campo: 'LEN' }, { id: 't2', tipo: 'tarea', campo: 'LEN' }, { id: 'w', tipo: 'trabajo', campo: 'LEN' }],
  calificaciones: { t1: { nivel: 'logrado' }, t2: { estado_entrega: 'no_entregado' }, w: { nivel: 'en_proceso' } },
  registros: ['21', '22', '23', '24'].map(function (d, i) { return { fecha: '2026-09-' + d, participacion: i === 0 ? 0 : 1, conducta: i < 2 ? 0 : 2 }; }),
  camposPorFecha: { '2026-09-21': ['LEN'], '2026-09-22': ['LEN'], '2026-09-23': ['LEN'], '2026-09-24': ['LEN'] },
  examenPorCampo: { LEN: 0.6 },
});
ok('cuadre a mano 28/28/6/33 (sin conducta): 57.9 / 95', Math.round(r.LEN.porcentaje * 10000) / 10000, Math.round(57.9 / 95 * 100 * 10000) / 10000);
ok('cuadre a mano: truncado a un decimal se ve 60.9 %', Math.floor(r.LEN.porcentaje * 10) / 10, 60.9);
// Pesos del maestro: peso_conducta se ignora (no se borra: el motor solo no lo usa)
ok('pesosDeAjustes: sin fila → 28/28/6/33 y conducta 0',
  JSON.stringify(M.pesosDeAjustes(null)), JSON.stringify({ tareas: 28, trabajos: 28, participacion: 6, examen: 33, conducta: 0 }));
ok('pesosDeAjustes: una conducta guardada de 20 se ignora',
  M.pesosDeAjustes({ peso_tareas: 25, peso_trabajos: 25, peso_participacion: 10, peso_conducta: 20, peso_examen: 20 }).conducta, 0);
ok('pesosDeAjustes: los otros cuatro se respetan',
  JSON.stringify(M.pesosDeAjustes({ peso_tareas: 25, peso_trabajos: 25, peso_participacion: 10, peso_conducta: 20, peso_examen: 20 })),
  JSON.stringify({ tareas: 25, trabajos: 25, participacion: 10, examen: 20, conducta: 0 }));
ok('pesosDeAjustes: un 0 guardado se respeta', M.pesosDeAjustes({ peso_tareas: 0, peso_trabajos: 50, peso_participacion: 0, peso_conducta: 0, peso_examen: 50 }).tareas, 0);
ok('pesosDeAjustes: si solo la conducta tenía peso, los de fábrica',
  JSON.stringify(M.pesosDeAjustes({ peso_tareas: 0, peso_trabajos: 0, peso_participacion: 0, peso_conducta: 100, peso_examen: 0 })),
  JSON.stringify({ tareas: 28, trabajos: 28, participacion: 6, conducta: 0, examen: 33 }));
ok('la conducta es el único rubro de referencia', M.RUBROS_REFERENCIA.join(','), 'conducta');

console.log(fallos === 0 ? '\nTODAS PASAN' : '\n' + fallos + ' FALLAS');
process.exit(fallos ? 1 : 0);
