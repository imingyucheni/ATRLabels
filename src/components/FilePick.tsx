"use client";

import { useEffect, useRef, useState } from "react";

/** 中文的文件选择控件（浏览器自带的是英文 “Choose File / No file chosen”） */
export default function FilePick({ name, accept, required, placeholder = "未选择文件" }: { name: string; accept?: string; required?: boolean; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState("");
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setFile("");
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);
  return (
    <span className="file-pick">
      <input
        ref={ref}
        type="file"
        name={name}
        accept={accept}
        required={required}
        onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")}
      />
      <button type="button" onClick={() => ref.current?.click()}>选择文件</button>
      <span className={file ? "" : "muted"}>{file || placeholder}</span>
    </span>
  );
}
