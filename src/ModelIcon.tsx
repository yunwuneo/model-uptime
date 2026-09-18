import { Layers3 } from 'lucide-react';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
import google from '@lobehub/icons-static-svg/icons/google-color.svg?url';
import xai from '@lobehub/icons-static-svg/icons/xai.svg?url';
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?url';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?url';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg?url';
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?url';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import baidu from '@lobehub/icons-static-svg/icons/baidu-color.svg?url';
import type { IconPreference, ModelBrand } from '../shared/types';
import { brandLabels, resolveModelBrand } from '../shared/model-brand';

const logos: Record<Exclude<ModelBrand, 'generic'>, string> = {
  openai,
  google,
  xai,
  anthropic,
  deepseek,
  meta,
  mistral,
  qwen,
  moonshot,
  doubao,
  zhipu,
  minimax,
  baidu,
};

export function ModelIcon({
  model,
  name = '',
  icon = 'auto',
}: {
  model: string;
  name?: string;
  icon?: IconPreference;
}) {
  const brand = resolveModelBrand(model, name, icon);
  return (
    <span
      className={`provider-icon ${brand}`}
      title={`${brandLabels[brand]} · ${icon === 'auto' ? '自动识别' : '手动指定'}`}
    >
      {brand === 'generic' ? (
        <Layers3 size={18} role="img" aria-label="通用模型图标" />
      ) : (
        <img src={logos[brand]} alt={`${brandLabels[brand]} 图标`} width={21} height={21} />
      )}
    </span>
  );
}
