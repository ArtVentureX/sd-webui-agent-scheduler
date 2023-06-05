import { Grid, GridOptions } from 'ag-grid-community';
import { Notyf } from 'notyf';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'notyf/notyf.min.css';
import './index.scss';

import { createPendingTasksStore } from './stores/pending.store';
import { ProgressResponse, ResponseStatus, Task, TaskStatus } from './types';
import { debounce } from '../utils/debounce';
import { extractArgs } from '../utils/extract-args';
import { createHistoryTasksStore } from './stores/history.store';
import { createSharedStore } from './stores/shared.store';

import deleteIcon from '../assets/icons/delete.svg?raw';
import cancelIcon from '../assets/icons/cancel.svg?raw';
import searchIcon from '../assets/icons/search.svg?raw';
import playIcon from '../assets/icons/play.svg?raw';
import rotateIcon from '../assets/icons/rotate.svg?raw';
import bookmark from '../assets/icons/bookmark.svg?raw';
import bookmarked from '../assets/icons/bookmark-filled.svg?raw';

const notyf = new Notyf();

declare global {
  var country: string;
  function gradioApp(): HTMLElement;
  function randomId(): string;
  function get_tab_index(name: string): number;
  function create_submit_args(args: IArguments): any[];
  function requestProgress(
    id: string,
    progressContainer: HTMLElement,
    imagesContainer: HTMLElement,
    onDone?: () => void,
    onProgress?: (res: ProgressResponse) => void,
  ): void;
  function onUiLoaded(callback: () => void): void;
  function submit_enqueue(): any[];
  function submit_enqueue_img2img(): any[];
  function agent_scheduler_status_filter_changed(value: string): void;
}

const sharedStore = createSharedStore({
  selectedTab: 'pending',
});

const pendingStore = createPendingTasksStore({
  current_task_id: null,
  total_pending_tasks: 0,
  pending_tasks: [],
  paused: false,
});

const historyStore = createHistoryTasksStore({
  total: 0,
  tasks: [],
});

const sharedGridOptions: GridOptions<Task> = {
  // default col def properties get applied to all columns
  defaultColDef: {
    sortable: false,
    filter: true,
    resizable: true,
    suppressMenu: true,
  },
  // each entry here represents one column
  columnDefs: [
    {
      field: 'name',
      headerName: 'Task Id',
      minWidth: 240,
      maxWidth: 240,
      pinned: 'left',
      rowDrag: true,
      editable: true,
      valueGetter: ({ data }) => data?.name ?? data?.id,
      cellClass: ({ data }) => [
        'cursor-pointer',
        data?.status === 'pending' ? 'task-pending' : '',
        data?.status === 'running' ? 'task-running' : '',
        data?.status === 'done' ? 'task-done' : '',
        data?.status === 'failed' ? 'task-failed' : '',
        data?.status === 'interrupted' ? 'task-interrupted' : '',
      ],
    },
    {
      field: 'type',
      headerName: 'Type',
      minWidth: 80,
      maxWidth: 80,
    },
    {
      headerName: 'Params',
      children: [
        {
          field: 'params.prompt',
          headerName: 'Prompt',
          minWidth: 400,
          autoHeight: true,
          wrapText: true,
          cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
        },
        {
          field: 'params.negative_prompt',
          headerName: 'Negative Prompt',
          minWidth: 400,
          autoHeight: true,
          wrapText: true,
          cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
        },
        {
          field: 'params.checkpoint',
          headerName: 'Checkpoint',
          minWidth: 150,
          maxWidth: 300,
          valueFormatter: ({ value }) => value || 'System',
        },
        {
          field: 'params.sampler_name',
          headerName: 'Sampler',
          width: 150,
          minWidth: 150,
        },
        {
          field: 'params.steps',
          headerName: 'Steps',
          minWidth: 80,
          maxWidth: 80,
          filter: 'agNumberColumnFilter',
        },
        {
          field: 'params.cfg_scale',
          headerName: 'CFG Scale',
          width: 100,
          minWidth: 100,
          filter: 'agNumberColumnFilter',
        },
        {
          field: 'params.size',
          headerName: 'Size',
          minWidth: 110,
          maxWidth: 110,
          valueGetter: ({ data }) => (data ? `${data.params.width}x${data.params.height}` : ''),
        },
        {
          field: 'params.batch',
          headerName: 'Batching',
          minWidth: 100,
          maxWidth: 100,
          valueGetter: ({ data }) =>
            data ? `${data.params.n_iter}x${data.params.batch_size}` : '1x1',
        },
      ],
    },
    { field: 'created_at', headerName: 'Date', minWidth: 200 },
  ],

  getRowId: ({ data }) => data.id,
  rowSelection: 'single', // allow rows to be selected
  animateRows: true, // have rows animate to new positions when sorted
  pagination: true,
  paginationAutoPageSize: true,
  suppressCopyRowsToClipboard: true,
  suppressRowTransform: true,
  enableBrowserTooltips: true,
  readOnlyEdit: true,
  onCellEditRequest: ({ data, newValue, api, colDef }) => {
    if (colDef.field !== 'name') return;
    if (!newValue) return;

    api.showLoadingOverlay();
    historyStore.renameTask(data.id, newValue).then((res) => {
      notify(res);
      const newData = { ...data, name: newValue };
      const tx = {
        update: [newData],
      };
      api.applyTransaction(tx);
      api.hideOverlay();
    });
  },
};

function initSearchInput(selector: string) {
  const searchContainer = gradioApp().querySelector(selector);
  if (!searchContainer) {
    throw new Error(`search container ${selector} not found`);
  }

  searchContainer.className = 'ts-search';
  searchContainer.innerHTML = `
    <div class="ts-search-icon">
      ${searchIcon}
    </div>
    <input type="text" class="ts-search-input" placeholder="Search" required>
  `;

  return searchContainer;
}

function notify(response: ResponseStatus) {
  if (response.success) {
    notyf.success(response.message);
  } else {
    notyf.error(response.message);
  }
}

function showTaskProgress(task_id: string, callback: () => void) {
  const args = extractArgs(requestProgress);

  const gallery: HTMLDivElement = gradioApp().querySelector(
    '#agent_scheduler_current_task_images',
  )!;

  // A1111 version
  if (args.includes('progressbarContainer')) {
    requestProgress(task_id, gallery, gallery, callback);
  } else {
    // Vlad version
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progressDiv';
    gallery.parentNode?.insertBefore(progressDiv, gallery);
    requestProgress(
      task_id,
      gallery,
      gallery,
      () => {
        gallery.parentNode?.removeChild(progressDiv);
        callback();
      },
      (res) => {
        if (!res) return;
        const perc = res ? `${Math.round((res?.progress || 0) * 100.0)}%` : '';
        const eta = res?.paused ? ' Paused' : ` ETA: ${Math.round(res?.eta || 0)}s`;
        progressDiv.innerText = `${perc}${eta}`;
        progressDiv.style.background = res
          ? `linear-gradient(to right, var(--primary-500) 0%, var(--primary-800) ${perc}, var(--neutral-700) ${perc})`
          : 'var(--button-primary-background-fill)';
      },
    );
  }
}

function initTabChangeHandler() {
  // watch for tab activation
  const observer = new MutationObserver(function (mutationsList) {
    mutationsList.forEach((styleChange) => {
      const tab = styleChange.target as HTMLElement;
      const visible = tab.style.display === 'block';
      if (!visible) return;

      if (tab.id === 'tab_agent_scheduler') {
        if (sharedStore.getState().selectedTab === 'pending') {
          pendingStore.refresh();
        } else {
          historyStore.refresh();
        }
      } else if (tab.id === 'agent_scheduler_pending_tasks_tab') {
        sharedStore.selectSelectedTab('pending');
        pendingStore.refresh();
      } else if (tab.id === 'agent_scheduler_history_tab') {
        sharedStore.selectSelectedTab('history');
        historyStore.refresh();
      }
    });
  });
  observer.observe(document.getElementById('tab_agent_scheduler')!, { attributeFilter: ['style'] });
  observer.observe(document.getElementById('agent_scheduler_pending_tasks_tab')!, {
    attributeFilter: ['style'],
  });
  observer.observe(document.getElementById('agent_scheduler_history_tab')!, {
    attributeFilter: ['style'],
  });
}

function initPendingTab() {
  const store = pendingStore;

  window.submit_enqueue = function submit_enqueue() {
    var id = randomId();
    var res = create_submit_args(arguments);
    res[0] = id;

    const btnEnqueue = document.querySelector('#txt2img_enqueue');
    if (btnEnqueue) {
      btnEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerHTML = 'Enqueue';
      }, 1000);
    }

    return res;
  };

  window.submit_enqueue_img2img = function submit_enqueue_img2img() {
    var id = randomId();
    var res = create_submit_args(arguments);
    res[0] = id;
    res[1] = get_tab_index('mode_img2img');

    const btnEnqueue = document.querySelector('#img2img_enqueue');
    if (btnEnqueue) {
      btnEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerHTML = 'Enqueue';
      }, 1000);
    }

    return res;
  };

  // detect queue button placement
  const interrogateCol: HTMLDivElement = gradioApp().querySelector('.interrogate-col')!;
  if (interrogateCol.childElementCount > 2) {
    interrogateCol.classList.add('has-queue-button');
  }

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_refresh')!;
  const pauseButton = gradioApp().querySelector('#agent_scheduler_action_pause')!;
  const resumeButton = gradioApp().querySelector('#agent_scheduler_action_resume')!;
  refreshButton.addEventListener('click', store.refresh);
  pauseButton.addEventListener('click', () => store.pauseQueue().then(notify));
  resumeButton.addEventListener('click', () => store.resumeQueue().then(notify));

  // watch for current task id change
  const onTaskIdChange = (id: string | null) => {
    if (id) {
      showTaskProgress(id, store.refresh);
    }
  };
  store.subscribe((curr, prev) => {
    if (prev.current_task_id !== curr.current_task_id) {
      onTaskIdChange(curr.current_task_id);
    }
    if (curr.paused) {
      pauseButton.classList.add('hide');
      resumeButton.classList.remove('hide');
    } else {
      pauseButton.classList.remove('hide');
      resumeButton.classList.add('hide');
    }
  });

  // init grid
  const gridOptions: GridOptions<Task> = {
    ...sharedGridOptions,
    // each entry here represents one column
    columnDefs: [
      {
        field: 'priority',
        hide: true,
        sort: 'asc',
      },
      ...(sharedGridOptions.columnDefs || []),
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data?.id,
        cellRenderer: ({ api, value, data }: any) => {
          if (!data) return undefined;

          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <button type="button" title="Run" ${
                data.status === 'running' ? 'disabled' : ''
              } class="ts-btn-action ts-btn-run">
                ${playIcon}
              </button>
              <button type="button" title="Delete" class="ts-btn-action ts-btn-delete">
                ${data.status === 'pending' ? deleteIcon : cancelIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild!;

          const btnRun = node.querySelector('button.ts-btn-run')!;
          btnRun.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.runTask(value).then(() => api.hideOverlay());
          });

          const btnDelete = node.querySelector('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.deleteTask(value).then((res) => {
              notify(res);
              api.applyTransaction({
                remove: [data],
              });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    onGridReady: ({ api }) => {
      // init quick search input
      const searchContainer = initSearchInput('#agent_scheduler_action_search');
      const searchInput: HTMLInputElement = searchContainer.querySelector('input.ts-search-input')!;
      searchInput.addEventListener(
        'keyup',
        debounce((e: KeyboardEvent) => {
          api.setQuickFilter((e.target as HTMLInputElement).value);
        }, 200),
      );

      store.subscribe((state) => {
        api.setRowData(state.pending_tasks);

        if (state.current_task_id) {
          const node = api.getRowNode(state.current_task_id);
          if (node) {
            api.refreshCells({ rowNodes: [node], force: true });
          }
        }

        api.sizeColumnsToFit();
      });
    },
    onRowDragEnd: ({ api, node, overNode }) => {
      const id = node.data?.id;
      const overId = overNode?.data?.id;
      if (id && overId && id !== overId) {
        api.showLoadingOverlay();
        store.moveTask(id, overId).then(() => api.hideOverlay());
      }
    },
  };

  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_pending_tasks_grid',
  )!;
  if (document.querySelector('.dark')) {
    eGridDiv.className = 'ag-theme-alpine-dark';
  }
  eGridDiv.style.height = 'calc(100vh - 300px)';
  new Grid(eGridDiv, gridOptions);
}

function initHistoryTab() {
  const store = historyStore;

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_refresh_history')!;
  refreshButton.addEventListener('click', () => {
    store.refresh();
  });
  const resultTaskId: HTMLTextAreaElement = gradioApp().querySelector(
    '#agent_scheduler_history_selected_task textarea',
  )!;
  const resultImageId: HTMLTextAreaElement = gradioApp().querySelector(
    '#agent_scheduler_history_selected_image textarea',
  )!;
  const resultGallery: HTMLDivElement = gradioApp().querySelector(
    '#agent_scheduler_history_gallery',
  )!;
  resultGallery.addEventListener('click', (e) => {
    const target = e.target as HTMLImageElement;
    if (target.tagName === 'IMG') {
      const imageIdx = Array.prototype.indexOf.call(
        target.parentNode?.parentNode?.childNodes ?? [],
        target.parentNode,
      );
      resultImageId.value = imageIdx.toString();
      resultImageId.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  window.agent_scheduler_status_filter_changed = function (value) {
    store.onFilterStatus(value?.toLowerCase() as TaskStatus);
  };

  // init grid
  const gridOptions: GridOptions<Task> = {
    ...sharedGridOptions,
    defaultColDef: {
      ...sharedGridOptions.defaultColDef,
      sortable: true,
    },
    // each entry here represents one column
    columnDefs: [
      {
        headerName: '',
        field: 'bookmarked',
        minWidth: 55,
        maxWidth: 55,
        pinned: 'left',
        sort: 'desc',
        cellClass: 'cursor-pointer pt-3',
        cellRenderer: ({ data, value }: any) => {
          if (!data) return undefined;
          return value
            ? `<span class="!text-yellow-400">${bookmarked}</span>`
            : `<span class="!text-gray-400">${bookmark}</span>`;
        },
        onCellClicked: ({ data, event, api }) => {
          if (!data) return;
          event?.stopPropagation();
          event?.preventDefault();
          store.bookmarkTask(data.id, !data.bookmarked).then((res) => {
            notify(res);
            api.applyTransaction({
              update: [{ ...data, bookmarked: !data.bookmarked }],
            });
          });
        },
      },
      {
        field: 'priority',
        hide: true,
        sort: 'desc',
      },
      {
        ...(sharedGridOptions.columnDefs || [])[0],
        rowDrag: false,
      },
      ...(sharedGridOptions.columnDefs || []).slice(1),
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data?.id,
        cellRenderer: ({ api, data, value }: any) => {
          if (!data) return undefined;

          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <button type="button" title="Requeue" class="ts-btn-action ts-btn-run">
                ${rotateIcon}
              </button>
              <button type="button" title="Delete" class="ts-btn-action ts-btn-delete">
                ${deleteIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild!;

          const btnRun = node.querySelector('button.ts-btn-run')!;
          btnRun.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.showLoadingOverlay();
            pendingStore.requeueTask(value).then((res) => {
              notify(res);
              api.hideOverlay();
            });
          });

          const btnDelete = node.querySelector('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.showLoadingOverlay();
            pendingStore.deleteTask(value).then((res) => {
              notify(res);
              api.applyTransaction({
                remove: [data],
              });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    rowSelection: 'single',
    suppressRowDeselection: true,
    onGridReady: ({ api }) => {
      // init quick search input
      const searchContainer = initSearchInput('#agent_scheduler_action_search_history');
      const searchInput: HTMLInputElement = searchContainer.querySelector('input.ts-search-input')!;
      searchInput.addEventListener(
        'keyup',
        debounce((e: KeyboardEvent) => {
          api.setQuickFilter((e.target as HTMLInputElement).value);
        }, 200),
      );

      store.subscribe((state) => {
        api.setRowData(state.tasks);
        api.sizeColumnsToFit();
      });
    },
    onSelectionChanged: (e) => {
      const [selected] = e.api.getSelectedRows();
      if (selected) {
        resultTaskId.value = selected.id;
        resultTaskId.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
  };
  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_history_tasks_grid',
  )!;
  if (document.querySelector('.dark')) {
    eGridDiv.className = 'ag-theme-alpine-dark';
  }
  eGridDiv.style.height = 'calc(100vh - 300px)';
  new Grid(eGridDiv, gridOptions);
}

onUiLoaded(() => {
  initTabChangeHandler();
  initPendingTab();
  initHistoryTab();
});
