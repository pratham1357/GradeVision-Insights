import { Navigate, Route, Routes } from "react-router-dom";

import { HomeRedirect } from "./components/HomeRedirect";
import { RequireInstructor, RequireStudent } from "./components/RequireRole";
import { AssessmentEditorPage } from "./pages/AssessmentEditorPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExamPage } from "./pages/ExamPage";
import { LoginPage } from "./pages/LoginPage";
import { QuestionEditorPage } from "./pages/QuestionEditorPage";
import { StudentDashboardPage } from "./pages/StudentDashboardPage";

/**
 * Two authenticated areas - instructor authoring and student assessment-taking -
 * each behind its own role guard. `/` routes to the right one for the signed-in
 * role. Routes for features that do not exist yet (results, proctoring) are not
 * declared.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<HomeRedirect />} />

      <Route element={<RequireInstructor />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/assessments/new" element={<AssessmentEditorPage />} />
        <Route path="/assessments/:assessmentId" element={<AssessmentEditorPage />} />
        <Route path="/questions/new" element={<QuestionEditorPage />} />
        <Route path="/questions/:questionId" element={<QuestionEditorPage />} />
      </Route>

      <Route element={<RequireStudent />}>
        <Route path="/student" element={<StudentDashboardPage />} />
        <Route path="/student/exam/:sessionId" element={<ExamPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
