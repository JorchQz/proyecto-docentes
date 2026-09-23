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
ok('part 50% + conducta 100% → 75%', r.LEN.porcentaje, 75);
ok('mismo resultado en SAB', r.SAB.porcentaje, 75);

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

console.log(fallos === 0 ? '\nTODAS PASAN' : '\n' + fallos + ' FALLAS');
process.exit(fallos ? 1 : 0);
