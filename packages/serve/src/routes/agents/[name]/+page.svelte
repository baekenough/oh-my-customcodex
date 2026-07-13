<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;

</script>

<div class="p-8 max-w-5xl">
	<!-- Breadcrumb -->
	<div class="text-sm text-zinc-600 mb-6">
		<a href="/agents" class="hover:text-zinc-400">Agents</a>
		<span class="mx-2">/</span>
		<span class="text-zinc-300">{data.agent.name}</span>
	</div>

	<!-- Header -->
	<div class="mb-8">
		<div class="flex items-center gap-3 mb-2">
			<h1 class="text-2xl font-bold text-zinc-50">{data.agent.name}</h1>
			<span class="px-2 py-0.5 rounded border text-xs font-medium bg-indigo-900/50 text-indigo-300 border-indigo-800">
				{data.agent.model}
			</span>
			<span class="px-2 py-0.5 rounded border text-xs font-medium bg-zinc-800 text-zinc-400 border-zinc-700">
				{data.agent.modelReasoningEffort} effort
			</span>
		</div>
		{#if data.agent.description}
			<p class="text-zinc-400">{data.agent.description}</p>
		{/if}
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Metadata -->
		<div class="lg:col-span-1 space-y-4">
			<!-- Frontmatter table -->
			<div class="border border-zinc-800 rounded-lg overflow-hidden">
				<div class="bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
					Metadata
				</div>
				<table class="w-full text-sm">
					<tbody>
						{#each data.displayMeta as { key, value }}
							<tr class="border-t border-zinc-800">
								<td class="px-4 py-2 text-zinc-500 font-medium w-28 shrink-0">{key}</td>
								<td class="px-4 py-2 text-zinc-300 break-all">{value || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Linked skills -->
			{#if data.agent.skills.length > 0}
				<div class="border border-zinc-800 rounded-lg overflow-hidden">
					<div class="bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
						Skills ({data.agent.skills.length})
					</div>
					<ul class="divide-y divide-zinc-800">
						{#each data.agent.skills as skill}
							<li class="px-4 py-2">
								<a href="/skills/{skill}" class="text-sky-400 hover:text-sky-300 text-sm">
									{skill}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<!-- Body -->
		<div class="lg:col-span-2">
			<div class="border border-zinc-800 rounded-lg p-6 prose">
				{@html data.renderedBody}
			</div>
		</div>
	</div>
</div>
