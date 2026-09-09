import { ArrowRight, GraduationCap, ShieldCheck, Users } from "lucide-react";

export default function HomeApp() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-green-50 p-6 flex items-center justify-center">
      <main className="w-full max-w-4xl">
        <header className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-[#67ad66] text-white flex items-center justify-center mx-auto shadow-lg shadow-green-200">
            <Users className="w-8 h-8" />
          </div>
          <h1 className="mt-5 text-3xl md:text-4xl font-bold text-[#1e3a5f]">Gross Anatomy Help Queue</h1>
          <p className="mt-3 text-gray-500">ระบบบริหารจัดการคำขอความช่วยเหลือในการเรียนปฏิบัติการมหกายวิภาคศาสตร์</p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <a href="/student" className="group bg-white rounded-3xl border border-pink-100 shadow-xl shadow-pink-100/50 p-7 transition-transform hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-pink-100">
            <div className="w-12 h-12 rounded-2xl bg-pink-100 flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-[#c96da0]" />
            </div>
            <h2 className="mt-5 text-xl font-bold text-[#1e3a5f]">Student</h2>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#c96da0]">Open student page <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></span>
          </a>

          <a href="/admin" className="group bg-white rounded-3xl border border-green-100 shadow-xl shadow-green-100/50 p-7 transition-transform hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-green-100">
            <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-[#67ad66]" />
            </div>
            <h2 className="mt-5 text-xl font-bold text-[#1e3a5f]">Instructor / Admin</h2>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#67ad66]">Open administration <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></span>
          </a>
        </section>

        <p className="text-center text-xs text-gray-400 mt-8">Faculty of Medicine · Chulalongkorn University</p>
      </main>
    </div>
  );
}
