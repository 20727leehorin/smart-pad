import React, { useState } from "react";
import Splash from "./components/Splash";
import PetPadMonitor from "./PetPadMonitor";

export default function App() {
  // 세션 중 한 번만 스플래시 보이도록 설정
  const [entered, setEntered] = useState(
    () => sessionStorage.getItem("seenSplash") === "1"
  );

  const handleEnter = () => {
    sessionStorage.setItem("seenSplash", "1");
    setEntered(true);
  };

  // 처음 들어왔을 때만 Splash 보여주기
  if (!entered) return <Splash onEnter={handleEnter} />;

  // 클릭 후 본 앱 실행
  return <PetPadMonitor />;
}
