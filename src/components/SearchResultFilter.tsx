'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SearchFilterOption {
  label: string;
  value: string;
}

export interface SearchFilterCategory {
  key: 'source' | 'title' | 'year';
  label: string;
  options: SearchFilterOption[];
}

interface SearchResultFilterProps {
  categories: SearchFilterCategory[];
  values: Partial<Record<SearchFilterCategory['key'], string>> & {
    yearOrder?: 'none' | 'asc' | 'desc';
  };
  onChange: (
    values: Record<SearchFilterCategory['key'], string> & {
      yearOrder: 'none' | 'asc' | 'desc';
    }
  ) => void;
}

const SearchResultFilter: React.FC<SearchResultFilterProps> = ({
  categories,
  values,
  onChange,
}) => {
  const [activeCategory, setActiveCategory] = useState<
    SearchFilterCategory['key'] | null
  >(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    x: number;
    y: number;
    width: number;
  }>({ x: 0, y: 0, width: 0 });
  const categoryRefs = useRef<
    Record<SearchFilterCategory['key'], HTMLButtonElement | null>
  >({
    source: null,
    title: null,
    year: null,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  const calculateDropdownPosition = (key: SearchFilterCategory['key']) => {
    const el = categoryRefs.current[key];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const isMobile = viewportWidth < 768;

    let x = rect.left;
    let dropdownWidth = Math.max(rect.width, 260);
    let useFixedWidth = false;

    if (isMobile) {
      const padding = 16;
      const maxWidth = viewportWidth - padding * 2;
      dropdownWidth = Math.min(Math.max(rect.width, 200), maxWidth);
      useFixedWidth = true;

      if (x + dropdownWidth > viewportWidth - padding) {
        x = viewportWidth - dropdownWidth - padding;
      }
      if (x < padding) {
        x = padding;
      }
    }

    setDropdownPosition({
      x,
      y: rect.bottom,
      width: useFixedWidth ? dropdownWidth : rect.width,
    });
  };

  const handleCategoryClick = (key: SearchFilterCategory['key']) => {
    if (activeCategory === key) {
      setActiveCategory(null);
    } else {
      setActiveCategory(key);
      calculateDropdownPosition(key);
    }
  };

  const handleOptionSelect = (
    catKey: SearchFilterCategory['key'],
    optVal: string
  ) => {
    const next: Record<SearchFilterCategory['key'], string> & {
      yearOrder: 'none' | 'asc' | 'desc';
    } = {
      source: values.source || 'all',
      title: values.title || 'all',
      year: values.year || 'all',
      yearOrder: values.yearOrder || 'none',
      [catKey]: optVal,
    };
    onChange(next);
    setActiveCategory(null);
  };

  const toggleYearOrder = () => {
    const currentOrder = values.yearOrder || 'none';
    let nextOrder: 'none' | 'asc' | 'desc';

    // 循环切换：none -> desc -> asc -> none
    if (currentOrder === 'none') {
      nextOrder = 'desc';
    } else if (currentOrder === 'desc') {
      nextOrder = 'asc';
    } else {
      nextOrder = 'none';
    }

    const next: Record<SearchFilterCategory['key'], string> & {
      yearOrder: 'none' | 'asc' | 'desc';
    } = {
      source: values.source || 'all',
      title: values.title || 'all',
      year: values.year || 'all',
      yearOrder: nextOrder,
    };
    onChange(next);
  };

  useEffect(() => {
    const handleScroll = () => {
      if (activeCategory) {
        calculateDropdownPosition(activeCategory);
      }
    };
    const handleResize = () => {
      if (activeCategory) {
        calculateDropdownPosition(activeCategory);
      }
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCategory]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !Object.values(categoryRefs.current).some(
          (ref) => ref && ref.contains(e.target as Node)
        )
      ) {
        setActiveCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDisplayText = (catKey: SearchFilterCategory['key']) => {
    const cat = categories.find((c) => c.key === catKey);
    if (!cat) return '';
    const val = values[catKey];
    if (!val || val === 'all') return cat.label;
    const opt = cat.options.find((o) => o.value === val);
    return opt?.label || cat.label;
  };

  const isDefault = (catKey: SearchFilterCategory['key']) => {
    const val = values[catKey];
    return !val || val === 'all';
  };

  const gridColsClass = (key: SearchFilterCategory['key']) => {
    if (key === 'year') return 'grid-cols-4 sm:grid-cols-6';
    if (key === 'source') return 'grid-cols-2 sm:grid-cols-3';
    return 'grid-cols-2 sm:grid-cols-2';
  };

  return (
    <>
      <div className='relative inline-flex rounded-full p-0.5 sm:p-1 bg-transparent gap-1 sm:gap-2'>
        {categories.map((cat) => (
          <div key={cat.key} className='inline-flex items-center gap-0.5'>
            <button
              ref={(el) => {
                categoryRefs.current[cat.key] = el;
              }}
              type='button'
              onClick={() => handleCategoryClick(cat.key)}
              className={`relative z-10 px-1.5 py-0.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                activeCategory === cat.key
                  ? isDefault(cat.key)
                    ? 'text-gray-900 dark:text-gray-100 cursor-pointer'
                    : 'text-green-600 dark:text-green-400 cursor-pointer'
                  : isDefault(cat.key)
                  ? 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
                  : 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 cursor-pointer'
              }`}
            >
              <span>{getDisplayText(cat.key)}</span>
              <svg
                className={`inline-block w-2.5 h-2.5 sm:w-3 sm:h-3 ml-0.5 sm:ml-1 transition-transform duration-200 ${
                  activeCategory === cat.key ? 'rotate-180' : ''
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>
            {cat.key === 'year' && (
              <button
                type='button'
                onClick={toggleYearOrder}
                className={`p-1 sm:p-1.5 rounded-full transition-all duration-200 ${
                  (values.yearOrder || 'none') === 'none'
                    ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100/60 dark:hover:bg-gray-700/60'
                    : 'text-green-600 dark:text-green-400 bg-green-50/80 dark:bg-green-900/20 hover:bg-green-100/80 dark:hover:bg-green-900/30'
                }`}
                title={
                  (values.yearOrder || 'none') === 'none'
                    ? '点击按年份倒序排列'
                    : (values.yearOrder || 'none') === 'desc'
                    ? '当前按年份倒序，点击切换为正序'
                    : '当前按年份正序，点击取消排序'
                }
                aria-label='切换年份排序'
              >
                {(values.yearOrder || 'none') === 'none' ? (
                  <ArrowUpDown className='w-3 h-3 sm:w-3.5 sm:h-3.5' />
                ) : (values.yearOrder || 'none') === 'asc' ? (
                  <ArrowUp className='w-3 h-3 sm:w-3.5 sm:h-3.5' />
                ) : (
                  <ArrowDown className='w-3 h-3 sm:w-3.5 sm:h-3.5' />
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {activeCategory &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              left: `${dropdownPosition.x}px`,
              top: `${dropdownPosition.y}px`,
              ...(window.innerWidth < 768
                ? { width: `${dropdownPosition.width}px` }
                : { minWidth: `${Math.max(dropdownPosition.width, 300)}px` }),
              maxWidth: '600px',
              zIndex: 9999,
            }}
            className='bg-white/95 dark:bg-gray-800/95 rounded-xl border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm shadow-xl max-h-[50vh] overflow-y-auto'
          >
            <div className='p-2 sm:p-4'>
              <div
                className={`grid ${gridColsClass(
                  activeCategory
                )} gap-1 sm:gap-2`}
              >
                {categories
                  .find((c) => c.key === activeCategory)
                  ?.options.map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() =>
                        handleOptionSelect(activeCategory, option.value)
                      }
                      className={`px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-lg transition-all duration-200 text-left truncate ${
                        (values[activeCategory] || 'all') === option.value
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                      }`}
                      title={option.label}
                    >
                      {option.label}
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default SearchResultFilter;
