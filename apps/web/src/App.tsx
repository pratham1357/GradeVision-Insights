import { Navigate, Route, Routes } from "react-router-dom";

import { RequireInstructor } from "./components/RequireInstructor";
import { AssessmentEditorPage } from "./pages/AssessmentEditorPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { QuestionEditorPage } from "./pages/QuestionEditorPage";

/**
 * Instructor assessment-authoring app. Routes for features that do not exist yet
 * (student assessment, exams, results) are intentionally not declared.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireInstructor />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/assessments/new" element={<AssessmentEditorPage />} />
        <Route path="/assessments/:assessmentId" element={<AssessmentEditorPage />} />
        <Route path="/questions/new" element={<QuestionEditorPage />} />
        <Route path="/questions/:questionId" element={<QuestionEditorPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
