import "./TextContainer.css";

interface Task {
  id: string;
  text: string;
  topic_id: string;
  task_idx: number;
}

interface TextProps {
  task: Task;
}

const TextContainer = ({ task }: TextProps) => {
  return (
    <section className="prompt-panel">
      <span className="app-eyebrow">Prompt {task.task_idx + 1}</span>
      <h2 className="prompt-panel__title">Say this short response</h2>
      <p className="prompt-panel__text">{task.text}</p>
    </section>
  );
};

export default TextContainer;
