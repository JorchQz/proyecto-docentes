document.addEventListener("DOMContentLoaded", async function () {
    if (!window.sb) {
        console.error("Supabase no esta configurado.");
        return;
    }

    const generateReportBtn = document.getElementById("generateReportBtn");
    const downloadPdfBtn = document.getElementById("downloadPdfBtn");
    const reportContainer = document.getElementById("reportContainer");
    const startDateInput = document.getElementById("startDate");
    const endDateInput = document.getElementById("endDate");

    let currentUserId = null;
    let currentGroup = null;
    let students = [];

    async function initialize() {
        try {
            const sessionResult = await window.sb.auth.getSession();
            if (sessionResult.error || !sessionResult.data.session) {
                window.location.href = "index.html";
                return;
            }
            currentUserId = sessionResult.data.session.user.id;
            await loadCurrentGroup();
            await loadStudents();
        } catch (error) {
            console.error("Error al inicializar:", error);
            reportContainer.innerHTML = "<p class='text-red-500'>Error al cargar los datos iniciales.</p>";
        }
    }

    async function loadCurrentGroup() {
        const { data, error } = await window.sb
            .from("grupos")
            .select("id, nombre")
            .eq("maestro_id", currentUserId)
            .single();

        if (error) throw error;

        if (!data) {
            window.location.href = "onboarding.html";
            return;
        }
        currentGroup = data;
    }

    async function loadStudents() {
        const { data, error } = await window.sb
            .from("alumnos")
            .select("id, nombre_completo, num_lista")
            .eq("maestro_id", currentUserId)
            .eq("grupo_id", currentGroup.id)
            .order("num_lista", { ascending: true });

        if (error) throw error;

        students = data || [];
    }

    function processAttendanceData(students, attendanceData) {
        const reportData = new Map();

        students.forEach(student => {
            reportData.set(student.id, {
                name: student.nombre_completo,
                num_lista: student.num_lista,
                presente: 0,
                ausente: 0,
                justificada: 0,
                total: 0
            });
        });

        attendanceData.forEach(record => {
            if (reportData.has(record.alumno_id)) {
                const studentSummary = reportData.get(record.alumno_id);
                if (record.asistencia_estado === 'presente') {
                    studentSummary.presente++;
                } else if (record.asistencia_estado === 'ausente') {
                    studentSummary.ausente++;
                } else if (record.asistencia_estado === 'justificada') {
                    studentSummary.justificada++;
                }
            }
        });
        
        // Calculate total days from the number of records for each student
        reportData.forEach(summary => {
            summary.total = summary.presente + summary.ausente + summary.justificada;
        });

        return Array.from(reportData.values());
    }

    function renderReport(processedData, startDate, endDate) {
        if (!processedData || processedData.length === 0) {
            reportContainer.innerHTML = "<p>No hay datos de asistencia para el rango de fechas seleccionado.</p>";
            return;
        }

        processedData.sort((a, b) => a.num_lista - b.num_lista);

        let tableHTML = `
            <h3 class="text-lg font-bold mb-2">Reporte de Asistencia del ${startDate} al ${endDate}</h3>
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">No.</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alumno</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Presentes</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Faltas</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Justificadas</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Días</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
        `;

        processedData.forEach(student => {
            tableHTML += `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${student.num_lista || ''}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${student.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${student.presente}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${student.ausente}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${student.justificada}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${student.total}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        reportContainer.innerHTML = tableHTML;
    }

    generateReportBtn.addEventListener("click", async () => {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) {
            reportContainer.innerHTML = "<p class='text-red-500'>Por favor, seleccione un rango de fechas.</p>";
            return;
        }

        reportContainer.innerHTML = "<p>Generando reporte...</p>";

        try {
            const { data: attendanceData, error: attendanceError } = await window.sb
                .from("asistencias")
                .select("alumno_id, fecha, asistencia_estado")
                .eq("maestro_id", currentUserId)
                .eq("grupo_id", currentGroup.id)
                .gte("fecha", startDate)
                .lte("fecha", endDate);

            if (attendanceError) throw attendanceError;

            const processedData = processAttendanceData(students, attendanceData);
            renderReport(processedData, startDate, endDate);

        } catch (error) {
            console.error("Error al generar el reporte:", error);
            reportContainer.innerHTML = `<p class='text-red-500'>Error al generar el reporte: ${error.message}</p>`;
        }
    });

    downloadPdfBtn.addEventListener("click", () => {
        const element = reportContainer.cloneNode(true);
        // Remove the h3 from the cloned element to avoid it in the pdf
        const h3 = element.querySelector('h3');
        if(h3) h3.remove();

        const opt = {
            margin:       1,
            filename:     `reporte-asistencia-${currentGroup.nombre}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        html2pdf().set(opt).from(element).save();
    });

    initialize();
});
