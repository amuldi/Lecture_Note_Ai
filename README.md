# Lecture_Note_Ai
# Lecture Notes AI

강의나 회의 음성을 자동으로 텍스트로 추출하고,  
편집 · 저장 · 관리할 수 있는 웹 애플리케이션입니다.  
**Clova Speech API** + **Next.js/React** 기반으로 동작합니다.

---

## 🚀 주요 기능
- 🎙️ **실시간 녹음** 및 업로드한 오디오 파일 추출
- ✏️ 전사 결과 직접 **편집/수정**
- 💾 **로컬 저장소**에 기록 보관 (여러 기록 관리 가능)
- 📂 기록 검색, 이름 변경, 삭제, 불러오기 지원
- ⏯️ 오디오와 전사 텍스트 **동기화 재생**
- 📊 문장 단위 타임라인 마커 표시

---

## 🛠️ 기술 스택
- **Frontend**: Next.js (React), TypeScript, TailwindCSS
- **Backend**: FastAPI (Python)
- **Speech-to-Text**: NAVER Clova Speech Recognition API
- **Storage**: LocalStorage (브라우저 기반 기록 관리)

---

## 📦 설치 & 실행

### 1. 저장소 클론
```bash
git clone https://github.com/<YOUR_USERNAME>/lecture-notes-ai.git
cd lecture-notes-ai
